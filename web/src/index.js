require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const path = require('path');
const Stripe = require('stripe');
const { Sequelize, DataTypes } = require('sequelize');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 auth requests per windowMs
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const containerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 container operations per hour
  message: { error: 'Too many container operations, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// CSRF protection configuration
const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  cookieName: '__Host-csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: process.env.NODE_ENV === 'production'
  },
  getTokenFromRequest: (req) => req.body._csrf || req.headers['x-csrf-token']
});

// Encryption utilities for storing sensitive tokens
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0, 32);
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text) return null;
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8'), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Decryption error:', error.message);
    return null;
  }
}

// Configuration from environment variables
const config = {
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackUrl: process.env.GITHUB_CALLBACK_URL || `http://localhost:${PORT}/auth/github/callback`
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    priceId: process.env.STRIPE_PRICE_ID,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
  },
  session: {
    secret: process.env.SESSION_SECRET || 'dev-session-secret'
  },
  railway: {
    apiToken: process.env.RAILWAY_API_TOKEN,
    projectId: process.env.RAILWAY_PROJECT_ID,
    templateId: process.env.RAILWAY_TEMPLATE_ID
  },
  app: {
    baseUrl: process.env.APP_BASE_URL || `http://localhost:${PORT}`,
    containerImage: process.env.CONTAINER_IMAGE || 'ghcr.io/yoans/copilot-cli-container:latest'
  }
};

// Initialize Stripe
const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;

// Database setup - supports SQLite for development and PostgreSQL for production
const databaseUrl = process.env.DATABASE_URL;
let sequelizeConfig;

if (databaseUrl && databaseUrl.startsWith('postgres')) {
  // PostgreSQL configuration for production (Railway)
  sequelizeConfig = {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: process.env.NODE_ENV === 'production' ? {
        require: true,
        rejectUnauthorized: false
      } : false
    }
  };
} else {
  // SQLite configuration for development
  sequelizeConfig = {
    dialect: 'sqlite',
    storage: databaseUrl || './database.sqlite',
    logging: false
  };
}

const sequelize = databaseUrl && databaseUrl.startsWith('postgres') 
  ? new Sequelize(databaseUrl, sequelizeConfig)
  : new Sequelize(sequelizeConfig);

// Models
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  githubId: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING
  },
  avatarUrl: {
    type: DataTypes.STRING
  },
  accessToken: {
    type: DataTypes.STRING
  },
  stripeCustomerId: {
    type: DataTypes.STRING
  },
  subscriptionStatus: {
    type: DataTypes.STRING,
    defaultValue: 'inactive'
  },
  subscriptionId: {
    type: DataTypes.STRING
  }
});

const Container = sequelize.define('Container', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  railwayServiceId: {
    type: DataTypes.STRING
  },
  sshHost: {
    type: DataTypes.STRING
  },
  sshPort: {
    type: DataTypes.INTEGER,
    defaultValue: 22
  },
  sshToken: {
    type: DataTypes.STRING
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pending'
  },
  expiresAt: {
    type: DataTypes.DATE
  }
});

User.hasMany(Container, { foreignKey: 'userId' });
Container.belongsTo(User, { foreignKey: 'userId' });

// Session store
const sessionStore = new SequelizeStore({
  db: sequelize
});

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting globally
app.use(apiLimiter);

app.use(session({
  secret: config.session.secret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// CSRF protection middleware (applied to state-changing routes)
// Skip CSRF for webhook endpoints and API verification
const csrfProtection = (req, res, next) => {
  // Skip CSRF for Stripe webhooks and API endpoints
  if (req.path.startsWith('/webhook/') || req.path.startsWith('/api/')) {
    return next();
  }
  // Skip for GET requests
  if (req.method === 'GET') {
    return next();
  }
  return doubleCsrfProtection(req, res, next);
};

// Make CSRF token available to views
app.use((req, res, next) => {
  // Generate CSRF token for views
  res.locals.csrfToken = generateToken(req, res);
  next();
});

// Passport GitHub Strategy
if (config.github.clientId && config.github.clientSecret) {
  passport.use(new GitHubStrategy({
    clientID: config.github.clientId,
    clientSecret: config.github.clientSecret,
    callbackURL: config.github.callbackUrl,
    scope: ['user:email', 'read:user']
  }, async (accessToken, _refreshToken, profile, done) => {
    try {
      // Encrypt the access token before storing
      const encryptedToken = encrypt(accessToken);
      
      let user = await User.findOne({ where: { githubId: profile.id } });
      
      if (!user) {
        user = await User.create({
          githubId: profile.id,
          username: profile.username,
          email: profile.emails?.[0]?.value,
          avatarUrl: profile.photos?.[0]?.value,
          accessToken: encryptedToken
        });
      } else {
        await user.update({
          username: profile.username,
          email: profile.emails?.[0]?.value,
          avatarUrl: profile.photos?.[0]?.value,
          accessToken: encryptedToken
        });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};

const hasActiveSubscription = async (req, res, next) => {
  if (req.user && req.user.subscriptionStatus === 'active') {
    return next();
  }
  res.redirect('/pricing');
};

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    user: req.user,
    config: {
      stripePublishableKey: config.stripe.publishableKey
    }
  });
});

app.get('/auth/github', passport.authenticate('github', { scope: ['user:email', 'read:user'] }));

app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
  const containers = await Container.findAll({ 
    where: { userId: req.user.id },
    order: [['createdAt', 'DESC']]
  });
  
  res.render('dashboard', { 
    user: req.user,
    containers,
    config: {
      stripePublishableKey: config.stripe.publishableKey
    }
  });
});

app.get('/pricing', isAuthenticated, (req, res) => {
  res.render('pricing', { 
    user: req.user,
    config: {
      stripePublishableKey: config.stripe.publishableKey,
      priceId: config.stripe.priceId
    }
  });
});

// Stripe checkout session
app.post('/create-checkout-session', authLimiter, csrfProtection, isAuthenticated, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  try {
    // Create or get Stripe customer
    let customerId = req.user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: {
          githubId: req.user.githubId,
          userId: req.user.id
        }
      });
      customerId = customer.id;
      await req.user.update({ stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: config.stripe.priceId,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${config.app.baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.app.baseUrl}/pricing`
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/subscription/success', isAuthenticated, async (req, res) => {
  const sessionId = req.query.session_id;
  
  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.subscription) {
        await req.user.update({
          subscriptionId: session.subscription,
          subscriptionStatus: 'active'
        });
      }
    } catch (error) {
      console.error('Error retrieving session:', error);
    }
  }
  
  res.redirect('/dashboard');
});

// Stripe webhook
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !config.stripe.webhookSecret) {
    return res.status(400).send('Webhook not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const user = await User.findOne({ 
        where: { stripeCustomerId: subscription.customer } 
      });
      
      if (user) {
        await user.update({
          subscriptionStatus: subscription.status === 'active' ? 'active' : 'inactive'
        });
      }
      break;
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Container management
app.post('/containers/create', containerLimiter, csrfProtection, isAuthenticated, hasActiveSubscription, async (req, res) => {
  try {
    // Generate SSH token for authentication
    const sshToken = uuidv4();
    
    // Create container record
    const container = await Container.create({
      userId: req.user.id,
      sshToken: sshToken,
      status: 'provisioning',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
    });

    // In production, this would trigger Railway API to deploy the container
    // For now, we simulate the container deployment
    if (config.railway.apiToken) {
      // Deploy to Railway
      try {
        const deployResult = await deployToRailway(container, req.user);
        await container.update({
          railwayServiceId: deployResult.serviceId,
          sshHost: deployResult.host,
          sshPort: deployResult.port,
          status: 'running'
        });
      } catch (deployError) {
        console.error('Railway deployment error:', deployError);
        await container.update({ status: 'failed' });
      }
    } else {
      // Demo mode - simulate deployment
      setTimeout(async () => {
        await container.update({
          sshHost: 'demo.railway.app',
          sshPort: 22,
          status: 'running'
        });
      }, 2000);
    }

    res.json({ 
      success: true, 
      container: {
        id: container.id,
        status: container.status,
        sshToken: sshToken
      }
    });
  } catch (error) {
    console.error('Container creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/containers/:id', isAuthenticated, async (req, res) => {
  const container = await Container.findOne({
    where: { id: req.params.id, userId: req.user.id }
  });

  if (!container) {
    return res.status(404).json({ error: 'Container not found' });
  }

  res.json({
    id: container.id,
    status: container.status,
    sshHost: container.sshHost,
    sshPort: container.sshPort,
    sshToken: container.sshToken,
    expiresAt: container.expiresAt
  });
});

app.delete('/containers/:id', containerLimiter, csrfProtection, isAuthenticated, async (req, res) => {
  const container = await Container.findOne({
    where: { id: req.params.id, userId: req.user.id }
  });

  if (!container) {
    return res.status(404).json({ error: 'Container not found' });
  }

  // In production, this would call Railway API to delete the service
  if (config.railway.apiToken && container.railwayServiceId) {
    try {
      await deleteFromRailway(container.railwayServiceId);
    } catch (error) {
      console.error('Railway deletion error:', error);
    }
  }

  await container.destroy();
  res.json({ success: true });
});

// Railway API functions (placeholder implementation)
async function deployToRailway(container, user) {
  // This would use the Railway API to deploy the container
  // https://docs.railway.app/reference/public-api
  
  // Decrypt the access token for container deployment
  const decryptedToken = decrypt(user.accessToken);
  
  const response = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.railway.apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `
        mutation ServiceCreate($input: ServiceCreateInput!) {
          serviceCreate(input: $input) {
            id
          }
        }
      `,
      variables: {
        input: {
          projectId: config.railway.projectId,
          source: {
            image: config.app.containerImage
          },
          variables: {
            SSH_TOKEN: container.sshToken,
            GITHUB_TOKEN: decryptedToken,
            USER_ID: user.id
          }
        }
      }
    })
  });

  const data = await response.json();
  
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }

  return {
    serviceId: data.data.serviceCreate.id,
    host: `${data.data.serviceCreate.id}.railway.app`,
    port: 22
  };
}

async function deleteFromRailway(serviceId) {
  await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.railway.apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `
        mutation ServiceDelete($id: String!) {
          serviceDelete(id: $id)
        }
      `,
      variables: { id: serviceId }
    })
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoint for container to verify token and get user's GitHub token
app.get('/api/verify-token', async (req, res) => {
  const token = req.headers['x-ssh-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const container = await Container.findOne({ where: { sshToken: token } });
  
  if (!container) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const user = await User.findByPk(container.userId);
  
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Decrypt the access token before sending
  const decryptedToken = decrypt(user.accessToken);

  res.json({
    valid: true,
    githubToken: decryptedToken,
    username: user.username
  });
});

// Initialize database and start server
async function start() {
  try {
    await sequelize.sync();
    sessionStore.sync();
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Visit ${config.app.baseUrl} to access the application`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

module.exports = { app, User, Container, sequelize };

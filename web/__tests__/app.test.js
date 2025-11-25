const { app, User, Container, sequelize } = require('../src/index');

describe('Health Check', () => {
  beforeAll(async () => {
    // Wait for database sync
    await sequelize.sync();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('Health endpoint returns ok', async () => {
    const response = await fetch('http://localhost:3000/health');
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
  });
});

describe('Database Models', () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('User model can be created', async () => {
    const user = await User.create({
      githubId: 'test123',
      username: 'testuser',
      email: 'test@example.com'
    });
    expect(user.id).toBeDefined();
    expect(user.githubId).toBe('test123');
    expect(user.subscriptionStatus).toBe('inactive');
  });

  test('Container model can be created', async () => {
    const user = await User.create({
      githubId: 'test456',
      username: 'testuser2',
      email: 'test2@example.com'
    });

    const container = await Container.create({
      userId: user.id,
      sshToken: 'test-token-123',
      status: 'pending'
    });

    expect(container.id).toBeDefined();
    expect(container.userId).toBe(user.id);
    expect(container.sshToken).toBe('test-token-123');
  });
});

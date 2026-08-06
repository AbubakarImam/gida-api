import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Run against a real (throwaway) Postgres — see docker-compose.yml.
 * `DATABASE_URL` should point at a disposable test database before running
 * `npm run test:e2e`; this suite does not mock Prisma.
 */
describe('Listings (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /listings is public and returns a paginated shape', async () => {
    const response = await request(app.getHttpServer()).get('/listings').expect(200);

    expect(response.body).toHaveProperty('items');
    expect(response.body).toHaveProperty('nextCursor');
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('POST /listings without a token is rejected', async () => {
    await request(app.getHttpServer())
      .post('/listings')
      .send({
        type: 'RENT',
        name: 'Test listing',
        description: 'A place',
        bedrooms: 1,
        bathrooms: 1,
        parking: false,
        furnished: false,
        address: '123 Main St',
        regularPriceCents: 100000,
        isOffer: false,
      })
      .expect(401);
  });

  it('GET /listings/:id returns 404 for an unknown id', async () => {
    await request(app.getHttpServer())
      .get('/listings/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });
});

/**
 * L2 (DB-free slice) — DTO validation contract.
 *
 * The grid page once sent `pageSize: 9999` and the backend rejected it with
 * "pageSize must not be greater than 100". That rule lives on `PaginationDto`
 * (the shared base every generated Query*Dto extends), so we can pin it here
 * with class-validator directly — no database, no HTTP, no supertest. This is
 * the cheapest place to guarantee the contract every generated list endpoint
 * inherits.
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';

const errorsFor = async (payload: object) =>
  validate(plainToInstance(PaginationDto, payload));

describe('PaginationDto contract (the pageSize cap that broke the grid)', () => {
  it('rejects pageSize greater than 100', async () => {
    expect((await errorsFor({ pageSize: 9999 })).length).toBeGreaterThan(0);
    expect((await errorsFor({ pageSize: 101 })).length).toBeGreaterThan(0);
  });

  it('accepts pageSize at or below the cap', async () => {
    expect((await errorsFor({ pageSize: 100 })).length).toBe(0);
    expect((await errorsFor({ pageSize: 1 })).length).toBe(0);
    expect((await errorsFor({ pageSize: 50 })).length).toBe(0);
  });

  it('rejects page below 1', async () => {
    expect((await errorsFor({ page: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor({ page: -3 })).length).toBeGreaterThan(0);
  });

  it('accepts valid page', async () => {
    expect((await errorsFor({ page: 1 })).length).toBe(0);
    expect((await errorsFor({ page: 42 })).length).toBe(0);
  });

  it('coerces stringified numbers (query params arrive as strings)', async () => {
    // Query params come in as strings; @Type(() => Number) must coerce before @Max applies.
    expect((await errorsFor({ pageSize: '9999' })).length).toBeGreaterThan(0);
    expect((await errorsFor({ pageSize: '50' })).length).toBe(0);
  });
});

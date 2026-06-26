import { Injectable } from '@nestjs/common';

@Injectable()
export class PurchaseOrderService {
  async findOne(_id: string, _userId?: string, _isAdmin?: boolean): Promise<any> { return null; }
  async create(_dto: any, _userId?: string): Promise<any> { return null; }
  async update(_id: string, _dto: any, _userId?: string, _isAdmin?: boolean): Promise<any> { return null; }
  async remove(_id: string, _userId?: string, _isAdmin?: boolean): Promise<void> { return; }
  async findAll(_query: any, _userId?: string, _isAdmin?: boolean): Promise<any> { return { list: [], total: 0 }; }
}

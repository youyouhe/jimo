import { ApiProperty } from '@nestjs/swagger';

export class DatabaseInfoDto {
  @ApiProperty({ example: 'localhost', description: 'Database host' })
  host: string = '';

  @ApiProperty({ example: 5432, description: 'Database port' })
  port: number = 0;

  @ApiProperty({ example: 'lowcode_db', description: 'Database name' })
  database: string = '';

  @ApiProperty({ example: 'postgres', description: 'Database username' })
  username: string = '';

  @ApiProperty({
    enum: ['connected', 'unavailable'],
    example: 'connected',
    description: 'Database connection status',
  })
  status: 'connected' | 'unavailable' = 'unavailable';
}

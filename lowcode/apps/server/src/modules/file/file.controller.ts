import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { FileService, SafeFile } from './file.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { QueryFileDto } from './dto/query-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'The file to upload',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'No file provided' })
  async upload(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiResp<SafeFile>> {
    if (!file) {
      throw new BadRequestException({
        code: 2001,
        message: 'No file provided. Use multipart form field name "file".',
      });
    }

    const data = await this.fileService.upload(file);
    return { code: 0, msg: 'success', data };
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of files' })
  @ApiResponse({ status: 200, description: 'Returns paginated files' })
  async findAll(
    @Query() query: QueryFileDto,
  ): Promise<PaginatedResponse<SafeFile>> {
    const data = await this.fileService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get('download/:id')
  @ApiOperation({ summary: 'Download a file by id (stream)' })
  @ApiOkResponse({
    description: 'File stream with Content-Type and Content-Disposition headers',
  })
  @ApiNotFoundResponse({ description: 'File not found' })
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentType, filename } = await this.fileService.download(id);

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });

    return new StreamableFile(stream);
  }

  @Get('info/:id')
  @ApiOperation({ summary: 'Get file info by id' })
  @ApiResponse({ status: 200, description: 'Returns file metadata' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getInfo(@Param('id') id: string): Promise<ApiResp<SafeFile>> {
    const data = await this.fileService.getFileInfo(id);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get file by id' })
  @ApiResponse({ status: 200, description: 'Returns the file' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SafeFile>> {
    const data = await this.fileService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update file name by id' })
  @ApiResponse({ status: 200, description: 'File name updated successfully' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFileDto,
  ): Promise<ApiResp<SafeFile>> {
    const data = await this.fileService.updateName(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete file by id (soft delete + MinIO removal)' })
  @ApiResponse({ status: 200, description: 'File deleted successfully' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.fileService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}

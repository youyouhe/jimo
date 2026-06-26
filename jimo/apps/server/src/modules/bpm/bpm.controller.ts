import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BpmService } from './bpm.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateProcessDto } from './dto/create-process.dto';
import { UpdateProcessDto } from './dto/update-process.dto';
import { QueryProcessDto } from './dto/query-process.dto';
import { ImportProcessXmlDto } from './dto/import-process.dto';

@ApiTags('BPM Process Definitions')
@ApiBearerAuth()
@Controller('bpm/definitions')
export class BpmController {
  constructor(private readonly bpmService: BpmService) {}

  @Post('/')
  @ApiOperation({ summary: 'Create process definition' })
  async create(
    @Body() dto: CreateProcessDto,
    @CurrentUser() user: { sub: string },
  ) {
    const data = await this.bpmService.create(dto, user.sub);
    return { code: 0, msg: 'success', data };
  }

  @Get('/')
  @ApiOperation({ summary: 'List process definitions (paginated, filterable)' })
  async findAll(@Query() query: QueryProcessDto) {
    const data = await this.bpmService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get process definition detail' })
  async findOne(@Param('id') id: string) {
    const data = await this.bpmService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update process definition (auto-creates new version when lfJson is provided)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProcessDto,
  ) {
    const data = await this.bpmService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete process definition' })
  async remove(@Param('id') id: string) {
    const data = await this.bpmService.remove(id);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List all versions of a process definition' })
  async getVersions(@Param('id') id: string) {
    const data = await this.bpmService.getVersions(id);
    return { code: 0, msg: 'success', data };
  }

  @Post(':id/versions')
  @ApiOperation({ summary: 'Create a new version for a process definition' })
  async createVersion(
    @Param('id') id: string,
    @Body() dto: { lfJson: Record<string, unknown>; name?: string; changeLog?: string },
  ) {
    const data = await this.bpmService.createVersion(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id/versions/:versionId')
  @ApiOperation({ summary: 'Get a specific version of a process definition' })
  async getVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    const data = await this.bpmService.getVersion(id, versionId);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id/versions/:versionId/export')
  @ApiOperation({ summary: 'Export a specific version of a process definition as BPMN 2.0 XML' })
  async exportVersionXml(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const xml = await this.bpmService.exportXml(id, versionId);
    if (res) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    }
    return { code: 0, msg: 'success', data: xml };
  }

  @Post(':id/deploy')
  @ApiOperation({ summary: 'Deploy a process version to the BPM Java engine' })
  async deploy(
    @Param('id') id: string,
    @Body() body: { versionId?: string },
  ) {
    const data = await this.bpmService.deployVersion(id, body?.versionId);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id/deploy-status')
  @ApiOperation({ summary: 'Get deployment status of a process definition' })
  async getDeployStatus(@Param('id') id: string) {
    const data = await this.bpmService.getDeployStatus(id);
    return { code: 0, msg: 'success', data };
  }

  // ===================== Import / Export =====================

  @Post('import')
  @ApiOperation({ summary: 'Import a BPMN 2.0 XML string and create a process definition' })
  async importXml(
    @Body() dto: ImportProcessXmlDto,
    @CurrentUser() user: { sub: string },
  ) {
    const data = await this.bpmService.importXml(dto, user.sub);
    return { code: 0, msg: 'success', data };
  }

  @Post('import/file')
  @ApiOperation({ summary: 'Import a BPMN 2.0 XML file (.bpmn/.xml) and create a process definition' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async importFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { name?: string; key?: string; category?: string },
  ) {
    if (!file) {
      return { code: 2001, msg: 'No file uploaded', data: null };
    }
    const xml = file.buffer.toString('utf-8');
    const data = await this.bpmService.importXml({ xml, ...body }, 'system');
    return { code: 0, msg: 'success', data };
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Export a process definition as BPMN 2.0 XML' })
  async exportXml(
    @Param('id') id: string,
    @Query('versionId') versionId?: string,
    @Headers('accept') accept?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const xml = await this.bpmService.exportXml(id, versionId);
    if (res) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    }
    return { code: 0, msg: 'success', data: xml };
  }
}

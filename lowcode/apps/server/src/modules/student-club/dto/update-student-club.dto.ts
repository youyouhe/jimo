import { PartialType } from '@nestjs/swagger';
import { CreateStudentClubDto } from './create-student-club.dto';

export class UpdateStudentClubDto extends PartialType(CreateStudentClubDto) {}

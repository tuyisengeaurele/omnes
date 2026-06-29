import { z } from 'zod';
import { EmployeeStatus, ContractType, Gender, LeaveType, LeaveStatus } from '@prisma/client';

export const createDepartmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const createEmployeeSchema = z.object({
  employeeNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  gender: z.nativeEnum(Gender),
  dateOfBirth: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  nationalId: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  address: z.string().min(1),
  departmentId: z.string().min(1),
  position: z.string().min(1),
  contractType: z.nativeEnum(ContractType),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bankName: z.string().min(1),
  bankAccountNumber: z.string().min(1),
  salary: z.number().positive(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();

export const updateEmployeeStatusSchema = z.object({
  status: z.nativeEnum(EmployeeStatus),
});

export const createAttendanceSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkIn: z.string().datetime({ offset: true }).optional(),
  checkOut: z.string().datetime({ offset: true }).optional(),
  hoursWorked: z.number().min(0).max(24).optional(),
  notes: z.string().optional(),
});

export const updateAttendanceSchema = createAttendanceSchema.partial();

export const createLeaveSchema = z.object({
  employeeId: z.string().min(1),
  leaveType: z.nativeEnum(LeaveType),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalDays: z.number().int().positive(),
  reason: z.string().min(1),
});

export const updateLeaveStatusSchema = z.object({
  status: z.nativeEnum(LeaveStatus),
  approvedBy: z.string().optional(),
});

export const createPayrollRunSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
});

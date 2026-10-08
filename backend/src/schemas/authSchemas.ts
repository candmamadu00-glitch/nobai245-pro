import { z } from 'zod';

// ==========================================
// 🚗 SCHEMAS DO PASSAGEIRO
// ==========================================

export const registerPassengerSchema = z.object({
  fullName: z
    .string({ message: 'O nome completo é obrigatório.' })
    .trim()
    .min(3, 'O nome deve ter no mínimo 3 caracteres.'),
  phone: z
    .string({ message: 'O número de telefone é obrigatório.' })
    .trim()
    .min(8, 'Número de telefone inválido.'),
  password: z
    .string({ message: 'A senha é obrigatória.' })
    .min(6, 'A senha deve ter no mínimo 6 caracteres.'),
  documentType: z
    .enum(['BI', 'PASSPORT', 'MIGRATORY_CARD'] as const, {
      message: 'Tipo de documento inválido.',
    })
    .optional(),
  documentNumber: z.string().trim().optional(),
});

export const loginPassengerSchema = z.object({
  phone: z
    .string({ message: 'Informe um telefone válido.' })
    .trim()
    .min(8, 'Informe um telefone válido.'),
  password: z
    .string({ message: 'A senha é obrigatória.' })
    .min(1, 'A senha é obrigatória.'),
  deviceToken: z.string().optional(),
});

export const updatePassengerPaymentSchema = z.object({
  paymentProvider: z.enum(['ORANGE_MONEY', 'MTN_MOMO'] as const, {
    message: 'Provedor deve ser ORANGE_MONEY ou MTN_MOMO.',
  }),
  paymentAccountNumber: z.string().trim().optional().nullable(),
});

export const estimateRideSchema = z.object({
  originLat: z.coerce.number({ message: 'Latitude de origem é obrigatória.' }),
  originLng: z.coerce.number({ message: 'Longitude de origem é obrigatória.' }),
  destinationLat: z.coerce.number({ message: 'Latitude de destino é obrigatória.' }),
  destinationLng: z.coerce.number({ message: 'Longitude de destino é obrigatória.' }),
  serviceType: z
    .enum(['RIDE', 'DELIVERY', 'RENTAL'] as const, {
      message: 'Tipo de serviço inválido.',
    })
    .optional(),
  vehicleType: z
    .enum(['PARTICULAR', 'TAXI', 'MOTO', 'MOTO_CARRO', 'TOCA_TOCA'] as const, {
      message: 'Tipo de veículo inválido.',
    })
    .optional(),
});

// ==========================================
// 🚘 SCHEMAS DO MOTORISTA
// ==========================================

export const registerDriverSchema = z.object({
  fullName: z
    .string({ message: 'O nome é obrigatório.' })
    .trim()
    .min(3, 'O nome deve ter no mínimo 3 caracteres.'),
  phone: z
    .string({ message: 'O telefone é obrigatório.' })
    .trim()
    .min(8, 'Número de telefone inválido.'),
  vehicleBrand: z
    .string({ message: 'Informe a marca/modelo do veículo.' })
    .trim()
    .min(2, 'Informe a marca/modelo do veículo.'),
  vehiclePlate: z
    .string({ message: 'Informe a placa do veículo.' })
    .trim()
    .min(3, 'Informe a placa do veículo.'),
  password: z
    .string({ message: 'A senha é obrigatória.' })
    .min(6, 'A senha deve ter no mínimo 6 caracteres.'),
  vehicleColor: z
    .string({ message: 'Informe a cor do veículo.' })
    .trim()
    .min(2, 'Informe a cor do veículo.'),
  vehicleType: z
    .enum(['PARTICULAR', 'TAXI', 'MOTO', 'MOTO_CARRO', 'TOCA_TOCA'] as const, {
      message: 'Tipo de veículo inválido.',
    })
    .default('TAXI'),
  documentType: z
    .enum(['BI', 'PASSPORT', 'MIGRATORY_CARD'] as const, {
      message: 'Tipo de documento inválido.',
    })
    .default('BI'),
  documentNumber: z
    .string({ message: 'Número do documento é obrigatório.' })
    .trim()
    .min(3, 'Número do documento é obrigatório.'),
});

export const loginDriverSchema = z.object({
  phone: z
    .string({ message: 'Informe um telefone válido.' })
    .trim()
    .min(8, 'Informe um telefone válido.'),
  password: z
    .string({ message: 'A senha é obrigatória.' })
    .min(1, 'A senha é obrigatória.'),
  deviceToken: z.string().optional(),
});

export const updateDriverPaymentSchema = z.object({
  mobileMoneyProvider: z.enum(['ORANGE_MONEY', 'MTN_MOMO'] as const, {
    message: 'Provedor deve ser ORANGE_MONEY ou MTN_MOMO.',
  }),
  mobileMoneyNumber: z
    .string({ message: 'O número da conta é obrigatório.' })
    .trim()
    .min(7, 'O número da conta Mobile Money é obrigatório.'),
});

export const requestProfileUpdateSchema = z
  .object({
    newFullName: z.string().trim().optional(),
    newVehiclePlate: z.string().trim().optional(),
    newVehicleBrand: z.string().trim().optional(),
    newVehicleColor: z.string().trim().optional(),
    newDocumentNumber: z.string().trim().optional(),
  })
  .refine((data) => Object.keys(data).some((key) => data[key as keyof typeof data] !== undefined), {
    message: 'Forneça pelo menos um campo para atualização.',
  });

// ==========================================
// 🔑 AUTENTICAÇÃO E CONTA
// ==========================================

export const googleSignInSchema = z.object({
  idToken: z
    .string({ message: 'Token do Google é obrigatório.' })
    .min(1, 'Token do Google é obrigatório.'),
  deviceToken: z.string().optional(),
});

export const completeGoogleRegistrationSchema = z.object({
  email: z.string().trim().email('E-mail inválido.'),
  fullName: z.string().trim().min(3, 'Nome obrigatório.'),
  phone: z.string().trim().min(8, 'Telefone inválido.'),
  profilePicture: z.string().url('URL inválida.').optional().or(z.literal('')),
  deviceToken: z.string().optional(),
});

export const updateDeviceTokenSchema = z.object({
  deviceToken: z
    .string({ message: 'Token de notificação é obrigatório.' })
    .min(1, 'Token de notificação é obrigatório.'),
});

export const forgotPasswordSchema = z.object({
  phone: z
    .string({ message: 'Informe um telefone válido.' })
    .trim()
    .min(8, 'Informe um telefone válido.'),
});

export const resetPasswordSchema = z.object({
  phone: z
    .string({ message: 'Informe um telefone válido.' })
    .trim()
    .min(8, 'Informe um telefone válido.'),
  code: z
    .string({ message: 'O código é obrigatório.' })
    .trim()
    .length(6, 'O código deve conter exatamente 6 dígitos.'),
  newPassword: z
    .string({ message: 'A nova senha é obrigatória.' })
    .min(6, 'A nova senha deve ter no mínimo 6 caracteres.'),
});
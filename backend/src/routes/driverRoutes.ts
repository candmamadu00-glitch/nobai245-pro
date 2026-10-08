import { Router } from 'express';
import { DriverAuthController } from '../controllers/DriverAuthController';
import { TicketController } from '../controllers/TicketController';
import { upload } from '../config/multer';
import { authenticate, authorizeRole } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import {
  registerDriverSchema,
  loginDriverSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateDriverPaymentSchema,
  updateDeviceTokenSchema,
  requestProfileUpdateSchema,
} from '../schemas/authSchemas';
import { 
  acceptRide, 
  driverArrived, 
  startRide, 
  finishRide, 
  cancelRide, 
  getRideChatHistory, 
  uploadChatAudio, 
  rateRide 
} from '../controllers/rideController';

const driverRoutes = Router();
const authController = new DriverAuthController();
const ticketController = new TicketController();

// -----------------------------------------------------------------------------
// 🟢 ROTAS PÚBLICAS (AUTENTICAÇÃO & RECUPERAÇÃO)
// -----------------------------------------------------------------------------

driverRoutes.post(
  '/register',
  upload.fields([
    { name: 'selfie', maxCount: 1 },
    { name: 'licenseFront', maxCount: 1 },
    { name: 'licenseBack', maxCount: 1 },
  ]),
  validate(registerDriverSchema),
  (req, res) => authController.register(req, res)
);

driverRoutes.post('/login', validate(loginDriverSchema), (req, res) => authController.login(req, res));
driverRoutes.post('/refresh-token', (req, res) => authController.refreshToken(req, res));
driverRoutes.post('/forgot-password', validate(forgotPasswordSchema), (req, res) => authController.forgotPassword(req, res));
driverRoutes.post('/reset-password', validate(resetPasswordSchema), (req, res) => authController.resetPassword(req, res));

// -----------------------------------------------------------------------------
// 🔒 ROTAS PROTEGIDAS (EXCLUSIVAS PARA MOTORISTAS)
// -----------------------------------------------------------------------------

driverRoutes.use(authenticate, authorizeRole(['DRIVER']));

// 👤 Perfil e Conta
driverRoutes.get('/profile', (req, res) => authController.getProfile(req, res));
driverRoutes.patch('/profile/picture', upload.single('profilePicture'), (req, res) => authController.updateProfilePicture(req, res));
driverRoutes.post('/request-update', validate(requestProfileUpdateSchema), (req, res) => authController.requestProfileUpdate(req, res));
driverRoutes.get('/request-update/status', (req, res) => authController.checkPendingRequest(req, res));
driverRoutes.delete('/delete-account', (req, res) => authController.deleteAccount(req, res));

// 💰 Financeiro & Configurações
driverRoutes.get('/finance', (req, res) => authController.getFinance(req, res));
driverRoutes.put('/payment-info', validate(updateDriverPaymentSchema), (req, res) => authController.updatePaymentInfo(req, res));
driverRoutes.put('/device-token', validate(updateDeviceTokenSchema), (req, res) => authController.updateDeviceToken(req, res));

// 🚗 Fluxo de Corridas (Motorista)
driverRoutes.post('/rides/accept', (req, res) => acceptRide(req, res));
driverRoutes.post('/rides/:rideId/arrived', (req, res) => driverArrived(req, res));
driverRoutes.post('/rides/:rideId/start', (req, res) => startRide(req, res));
driverRoutes.post('/rides/:rideId/finish', (req, res) => finishRide(req, res));
driverRoutes.post('/rides/cancel', (req, res) => cancelRide(req, res));

// 💬 Chat da Corrida
driverRoutes.get('/rides/:rideId/chat', (req, res) => getRideChatHistory(req, res));
driverRoutes.post('/rides/:rideId/chat/audio', upload.single('audio'), (req, res) => uploadChatAudio(req, res));

// ⭐ Avaliação & Emergência (SOS)
driverRoutes.post('/rides/rate', (req, res) => rateRide(req, res));
driverRoutes.post('/sos', (req, res) => authController.triggerSos(req, res));

// 🎫 Suporte & Tickets
driverRoutes.post('/tickets', (req, res) => ticketController.create(req, res));
driverRoutes.get('/tickets/my-tickets', (req, res) => ticketController.getMyTickets(req, res));
driverRoutes.post('/tickets/:ticketId/reply', (req, res) => ticketController.reply(req, res));

export { driverRoutes };
export default driverRoutes;
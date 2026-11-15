import { prisma } from '../config/prisma';
import { Router } from 'express';
import { PassengerAuthController } from '../controllers/PassengerAuthController';
import { TicketController } from '../controllers/TicketController';
import { MobileSyncController } from '../controllers/MobileSyncController';
import { upload } from '../config/multer';
import { authenticate, authorizeRole } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import {
  registerPassengerSchema,
  loginPassengerSchema,
  updatePassengerPaymentSchema,
  updateDeviceTokenSchema,
  estimateRideSchema,
  googleSignInSchema,
  completeGoogleRegistrationSchema
} from '../schemas/authSchemas';
import { estimateRidePrice, getRideChatHistory, rateRide, cancelRide } from '../controllers/rideController';

const passengerRoutes = Router();
const authController = new PassengerAuthController();
const ticketController = new TicketController();
const mobileSyncController = new MobileSyncController();

// 🛡️ Middleware flexível para avatar do passageiro
const handlePassengerAvatarUpload = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
  { name: 'photo', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]);

// -----------------------------------------------------------------------------
// 🟢 ROTAS PÚBLICAS
// -----------------------------------------------------------------------------
passengerRoutes.post('/register', validate(registerPassengerSchema), (req, res) => authController.register(req, res));
passengerRoutes.post('/request-otp', (req, res) => authController.requestOTP(req, res));
passengerRoutes.post('/forgot-password', (req, res) => authController.requestOTP(req, res));
passengerRoutes.post('/verify-otp', (req, res) => authController.verifyOTP(req, res));
passengerRoutes.post('/login', validate(loginPassengerSchema), (req, res) => authController.login(req, res));
passengerRoutes.post('/refresh-token', (req, res) => authController.refreshToken(req, res));
passengerRoutes.post('/payments/initiate', authenticate, authorizeRole(['PASSENGER']), (req, res) => authController.initiatePayment(req, res));

// 🛡️ Autenticação Google
passengerRoutes.post('/auth/google', validate(googleSignInSchema), (req, res) => authController.googleSignIn(req, res));
passengerRoutes.post('/google-login', validate(googleSignInSchema), (req, res) => authController.googleSignIn(req, res));
passengerRoutes.post('/auth/google/complete', validate(completeGoogleRegistrationSchema), (req, res) => authController.completeGoogleRegistration(req, res));

// -----------------------------------------------------------------------------
// 🔒 ROTAS PROTEGIDAS (EXCLUSIVAS PARA PASSAGEIROS)
// -----------------------------------------------------------------------------
passengerRoutes.use(authenticate, authorizeRole(['PASSENGER']));

passengerRoutes.get('/profile', (req, res) => authController.getProfile(req, res));
passengerRoutes.put('/me', handlePassengerAvatarUpload, (req, res) => authController.updateProfile(req, res));
passengerRoutes.get('/finance', (req, res) => authController.getFinance(req, res));
passengerRoutes.post('/wallet/recharge', (req, res) => authController.rechargeWallet(req, res));
passengerRoutes.get('/rides', (req, res) => authController.getRideHistory(req, res));
passengerRoutes.get('/rides/:rideId/chat', (req, res) => getRideChatHistory(req, res));
passengerRoutes.get('/emergency-contacts', (req, res) => authController.getEmergencyContacts(req, res));
passengerRoutes.post('/emergency-contacts', (req, res) => authController.addEmergencyContact(req, res));
passengerRoutes.put('/payment-method', validate(updatePassengerPaymentSchema), (req, res) => authController.updatePaymentMethod(req, res));
passengerRoutes.put('/device-token', validate(updateDeviceTokenSchema), (req, res) => authController.updateDeviceToken(req, res));
passengerRoutes.post('/estimate', validate(estimateRideSchema), (req, res) => estimateRidePrice(req, res));
passengerRoutes.post('/coupons/validate', (req, res) => mobileSyncController.validateCoupon(req, res));
passengerRoutes.get('/promotions', (req, res) => mobileSyncController.getActivePromotions(req, res));
passengerRoutes.get('/corporate-status', (req, res) => mobileSyncController.getCorporateStatus(req, res));
passengerRoutes.post('/rides/rate', (req, res) => rateRide(req, res));
passengerRoutes.post('/rides/cancel', (req, res) => cancelRide(req, res));

// 🚨 Alerta de Emergência SOS (Fallback HTTP + Painel Admin em Tempo Real)
passengerRoutes.post('/sos', async (req: any, res) => {
  try {
    const userId = req.user?.id;
    const { rideId, latitude, longitude } = req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!userId || isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Coordenadas de emergência inválidas.' });
    }

    const validRideId = typeof rideId === 'string' && /^[0-9a-fA-F-]{36}$/.test(rideId) ? rideId : null;

    const alert = await prisma.sosAlert.create({
      data: {
        rideId: validRideId,
        userType: 'PASSENGER' as any,
        passengerId: userId,
        driverId: null,
        lat,
        lng,
        status: 'ACTIVE',
      },
    });

    return res.status(201).json({ success: true, alertId: alert.id });
  } catch (err) {
    console.error('❌ [HTTP_SOS_ERROR]', err);
    return res.status(500).json({ error: 'Erro ao registrar alerta de emergência.' });
  }
});



passengerRoutes.delete('/me', (req, res) => authController.deleteAccount(req, res));

// Chamados de Suporte
passengerRoutes.get('/tickets/me', (req, res) => ticketController.getMyTickets(req, res));
passengerRoutes.post('/tickets', (req, res) => ticketController.create(req, res));
passengerRoutes.post('/tickets/:ticketId/reply', (req, res) => ticketController.reply(req, res));

export { passengerRoutes };
export default passengerRoutes;
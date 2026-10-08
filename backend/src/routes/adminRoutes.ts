import { Router } from 'express';
import { AdminAuthController } from '../controllers/AdminAuthController';
import { AdminTicketController } from '../controllers/AdminTicketController';
import { AdminRatingController } from '../controllers/AdminRatingController';
import { AdminSosController } from '../controllers/AdminSosController';
import { AdminDashboardController } from '../controllers/AdminDashboardController';
import { AdminSettingsController } from '../controllers/AdminSettingsController';
import { AdminFinanceController } from '../controllers/AdminFinanceController';

import { authenticate, authorizeRole } from '../middlewares/authMiddleware';

const adminRoutes = Router();

const adminController = new AdminAuthController();
const ticketController = new AdminTicketController();
const adminFinanceController = new AdminFinanceController();

// ==========================================
// 🟢 ROTAS PÚBLICAS (AUTENTICAÇÃO ADMIN)
// ==========================================
adminRoutes.post('/register', (req, res) => adminController.register(req, res));
adminRoutes.post('/login', (req, res) => adminController.login(req, res));

// ==========================================
// 🔒 ROTAS PROTEGIDAS (EXIGE TOKEN VÁLIDO)
// ==========================================
adminRoutes.use(authenticate);

// ------------------------------------------
// 👑 ROTAS EXCLUSIVAS DO SUPER_ADMIN
// ------------------------------------------
adminRoutes.put(
  '/settings/system', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => AdminSettingsController.updateSystemConfig(req, res)
);

adminRoutes.put(
  '/settings/tariffs/:id', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => AdminSettingsController.updateTariff(req, res)
);

adminRoutes.post(
  '/finance/recharge', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => adminFinanceController.manualRecharge(req, res)
);

adminRoutes.post(
  '/finance/retry-transaction/:id', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => adminFinanceController.retryTransaction(req, res)
);

adminRoutes.get(
  '/users', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => adminController.listAdmins(req, res)
);

adminRoutes.post(
  '/users', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => adminController.createAdmin(req, res)
);

adminRoutes.patch(
  '/users/:adminId/status', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => adminController.toggleAdminStatus(req, res)
);

// ------------------------------------------
// 💰 ROTAS FINANCEIRAS (SUPER_ADMIN + FINANCE)
// ------------------------------------------
adminRoutes.get(
  '/finance/dashboard', 
  authorizeRole(['SUPER_ADMIN', 'FINANCE']), 
  (req, res) => adminFinanceController.getDashboard(req, res)
);

adminRoutes.get(
  '/finance/export', 
  authorizeRole(['SUPER_ADMIN', 'FINANCE']), 
  (req, res) => adminFinanceController.exportTransactions(req, res)
);

// ------------------------------------------
// 🚨 OPERAÇÕES & ATENDIMENTO (SUPER_ADMIN + OPERATOR)
// ------------------------------------------
adminRoutes.patch(
  '/approve-driver/:driverId', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => adminController.approveDriver(req, res)
);

adminRoutes.get(
  '/driver-requests', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => adminController.listDriverChangeRequests(req, res)
);

adminRoutes.put(
  '/driver-requests/:requestId/review', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => adminController.reviewDriverChangeRequest(req, res)
);

adminRoutes.get(
  '/sos', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => AdminSosController.listSosAlerts(req, res)
);

adminRoutes.patch(
  '/sos/:sosId/status', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => AdminSosController.updateSosStatus(req, res)
);

adminRoutes.get(
  '/tickets', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => ticketController.listTickets(req, res)
);

adminRoutes.post(
  '/tickets/:ticketId/reply', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => ticketController.replyTicket(req, res)
);

adminRoutes.patch(
  '/tickets/:ticketId/assign', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => ticketController.assignTicket(req, res)
);

// ------------------------------------------
// 📊 CONSULTAS GERAIS & MONITORAMENTO
// ------------------------------------------
adminRoutes.get(
  '/dashboard/metrics', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => AdminDashboardController.getMetrics(req, res)
);

adminRoutes.get(
  '/rides', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => AdminDashboardController.getRides(req, res)
);

adminRoutes.get(
  '/rides/:rideId/chat', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => AdminDashboardController.getRideChat(req, res)
);

adminRoutes.get(
  '/rides/:rideId/telemetry', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => AdminDashboardController.getRideTelemetry(req, res)
);

adminRoutes.get(
  '/drivers', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => adminController.listDrivers(req, res)
);

adminRoutes.get(
  '/drivers/online', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => adminController.getOnlineDrivers(req, res)
);

adminRoutes.patch(
  '/drivers/:driverId/status', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => adminController.toggleDriverStatus(req, res)
);

adminRoutes.get(
  '/passengers', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => adminController.listPassengers(req, res)
);

adminRoutes.patch(
  '/passengers/:passengerId/status', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => adminController.togglePassengerStatus(req, res)
);

adminRoutes.get(
  '/settings/system', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => AdminSettingsController.getSystemConfig(req, res)
);

adminRoutes.get(
  '/settings/tariffs', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => AdminSettingsController.getTariffs(req, res)
);

adminRoutes.get(
  '/ratings', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), 
  (req, res) => AdminRatingController.listRatings(req, res)
);

adminRoutes.patch(
  '/ratings/:ratingId/moderation', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => (AdminRatingController as any).toggleApproval(req, res)
);

// ------------------------------------------
// 🗑️ GESTÃO DE EXCLUSÃO DE CONTAS (SOFT DELETE)
// ------------------------------------------
adminRoutes.delete(
  '/drivers/:driverId', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => adminController.deleteDriver(req, res)
);

adminRoutes.delete(
  '/passengers/:passengerId', 
  authorizeRole(['SUPER_ADMIN']), 
  (req, res) => adminController.deletePassenger(req, res)
);

adminRoutes.get(
  '/account-deletion-requests', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => adminController.listAccountDeletionRequests(req, res)
);

adminRoutes.patch(
  '/account-deletion-requests/:requestId/review', 
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']), 
  (req, res) => adminController.reviewAccountDeletionRequest(req, res)
);

export { adminRoutes };
export default adminRoutes;
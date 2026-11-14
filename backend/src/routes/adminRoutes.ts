import { Router } from 'express';
import { AdminAuthController } from '../controllers/AdminAuthController';
import { AdminTicketController } from '../controllers/AdminTicketController';
import { AdminRatingController } from '../controllers/AdminRatingController';
import { AdminSosController } from '../controllers/AdminSosController';
import { AdminDashboardController } from '../controllers/AdminDashboardController';
import { AdminSettingsController } from '../controllers/AdminSettingsController';
import { AdminFinanceController } from '../controllers/AdminFinanceController';
import { AdminEnterpriseController } from '../controllers/AdminEnterpriseController';
import { AdminScaleController } from '../controllers/AdminScaleController';
import { prisma } from '../lib/prisma';

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

// 🛡️ TRILHA DE AUDITORIA AUTOMÁTICA PARA AÇÕES DOS COLABORADORES
adminRoutes.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const adminId = (req as any).user?.id;
    if (adminId) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          const cleanBody: Record<string, any> = {};
          if (req.body && typeof req.body === 'object') {
            for (const [k, v] of Object.entries(req.body)) {
              if (!k.toLowerCase().includes('password') && !k.toLowerCase().includes('token')) {
                cleanBody[k] = v;
              }
            }
          }
          const parts = req.path.split('/').filter(Boolean);
          const targetType = (parts[0] || 'SYSTEM').toUpperCase().slice(0, 45);
          const targetId = parts[1] ? String(parts[1]).slice(0, 95) : null;
          const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 44);

          prisma.adminAuditLog.create({
            data: {
              adminId: String(adminId),
              action: `${req.method} ${req.path}`.slice(0, 95),
              targetType,
              targetId,
              ipAddress: ip || null,
              payload: Object.keys(cleanBody).length > 0 ? cleanBody : undefined
            }
          }).catch(() => {});
        }
      });
    }
  }
  next();
});

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
  '/drivers/:driverId/wallet',
  authorizeRole(['SUPER_ADMIN', 'FINANCE', 'OPERATOR']),
  (req, res) => adminFinanceController.getDriverWallet(req, res)
);

adminRoutes.patch(
  '/drivers/:driverId/wallet',
  authorizeRole(['SUPER_ADMIN', 'FINANCE']),
  (req, res) => adminFinanceController.adjustDriverWallet(req, res)
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
// 🗑️ GESTÃO DE EXCLUSÃO DE CONTAS
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


adminRoutes.patch(
  '/rides/:rideId/force-cancel',
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']),
  (req, res) => AdminDashboardController.forceCancelRide(req, res)
);

adminRoutes.post(
  '/finance/approve-transaction/:id',
  authorizeRole(['SUPER_ADMIN', 'FINANCE']),
  (req, res) => adminFinanceController.approveAndCreditTransaction(req, res)
);

adminRoutes.get(
  '/passengers/:passengerId/wallet',
  authorizeRole(['SUPER_ADMIN', 'FINANCE', 'OPERATOR']),
  (req, res) => adminFinanceController.getPassengerWallet(req, res)
);

adminRoutes.patch(
  '/passengers/:passengerId/wallet',
  authorizeRole(['SUPER_ADMIN', 'FINANCE']),
  (req, res) => adminFinanceController.adjustPassengerWallet(req, res)
);


adminRoutes.get(
  '/finance/driver-closing',
  authorizeRole(['SUPER_ADMIN', 'FINANCE', 'OPERATOR']),
  (req, res) => adminFinanceController.getDriverDailyClosing(req, res)
);

adminRoutes.post(
  '/finance/driver-closing/payout',
  authorizeRole(['SUPER_ADMIN', 'FINANCE']),
  (req, res) => adminFinanceController.settleDriverPayout(req, res)
);


adminRoutes.patch(
  '/rides/:rideId/force-finish',
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']),
  (req, res) => AdminDashboardController.forceFinishRide(req, res)
);

adminRoutes.patch(
  '/rides/:rideId/assign-driver',
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']),
  (req, res) => AdminDashboardController.assignDriverToRide(req, res)
);

adminRoutes.post(
  '/rides/manual-dispatch',
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']),
  (req, res) => AdminDashboardController.manualDispatchRide(req, res)
);

adminRoutes.patch(
  '/users-unlock/:userType/:userId',
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']),
  (req, res) => AdminDashboardController.unlockUserApp(req, res)
);


// ------------------------------------------
// 🏢 GOVERNANÇA, CUPONS, COMUNICADOS & BI EMPRESARIAL
// ------------------------------------------
adminRoutes.patch(
  '/users/:adminId/role',
  authorizeRole(['SUPER_ADMIN']),
  (req, res) => adminController.updateAdminRole(req, res)
);

adminRoutes.patch(
  '/users/:adminId/reset-password',
  authorizeRole(['SUPER_ADMIN']),
  (req, res) => adminController.resetAdminPassword(req, res)
);

adminRoutes.get(
  '/audit-logs',
  authorizeRole(['SUPER_ADMIN']),
  (req, res) => AdminEnterpriseController.listAuditLogs(req, res)
);

adminRoutes.get(
  '/promos',
  authorizeRole(['SUPER_ADMIN', 'FINANCE', 'OPERATOR']),
  (req, res) => AdminEnterpriseController.listPromoCodes(req, res)
);

adminRoutes.post(
  '/promos',
  authorizeRole(['SUPER_ADMIN', 'FINANCE']),
  (req, res) => AdminEnterpriseController.createPromoCode(req, res)
);

adminRoutes.patch(
  '/promos/:id/toggle',
  authorizeRole(['SUPER_ADMIN', 'FINANCE']),
  (req, res) => AdminEnterpriseController.togglePromoCode(req, res)
);

adminRoutes.delete(
  '/promos/:id',
  authorizeRole(['SUPER_ADMIN']),
  (req, res) => AdminEnterpriseController.deletePromoCode(req, res)
);

adminRoutes.post(
  '/broadcast/push',
  authorizeRole(['SUPER_ADMIN', 'OPERATOR']),
  (req, res) => AdminEnterpriseController.sendBroadcastPush(req, res)
);

adminRoutes.get(
  '/analytics/overview',
  authorizeRole(['SUPER_ADMIN', 'FINANCE', 'OPERATOR']),
  (req, res) => AdminEnterpriseController.getOperationalAnalytics(req, res)
);


// ------------------------------------------
// 🚀 ESCALA EMPRESARIAL (B2B, FROTISTAS, ANTIFRAUDE, ZONAS, MISSÕES, DRE)
// ------------------------------------------
adminRoutes.get('/enterprise/corporates', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.listCorporates(req, res));
adminRoutes.post('/enterprise/corporates', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.createCorporate(req, res));
adminRoutes.patch('/enterprise/corporates/:id/balance', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.adjustCorporateBalance(req, res));
adminRoutes.post('/enterprise/corporates/:id/employees', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.addCorporateEmployee(req, res));
adminRoutes.delete('/enterprise/corporates/employees/:empId', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.removeCorporateEmployee(req, res));

adminRoutes.get('/enterprise/fleet-partners', authorizeRole(['SUPER_ADMIN', 'FINANCE', 'OPERATOR']), (req, res) => AdminScaleController.listFleetPartners(req, res));
adminRoutes.post('/enterprise/fleet-partners', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.createFleetPartner(req, res));
adminRoutes.post('/enterprise/fleet-partners/:id/assign-driver', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.assignDriverToPartner(req, res));
adminRoutes.delete('/enterprise/fleet-partners/drivers/:linkId', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.unlinkDriverFromPartner(req, res));

adminRoutes.get('/enterprise/antifraud/scan', authorizeRole(['SUPER_ADMIN', 'OPERATOR']), (req, res) => AdminScaleController.scanAntiFraud(req, res));
adminRoutes.post('/enterprise/blacklist', authorizeRole(['SUPER_ADMIN', 'OPERATOR']), (req, res) => AdminScaleController.addBlacklistEntry(req, res));
adminRoutes.delete('/enterprise/blacklist/:id', authorizeRole(['SUPER_ADMIN']), (req, res) => AdminScaleController.removeBlacklistEntry(req, res));

adminRoutes.get('/enterprise/zones', authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), (req, res) => AdminScaleController.listZones(req, res));
adminRoutes.post('/enterprise/zones', authorizeRole(['SUPER_ADMIN']), (req, res) => AdminScaleController.createZone(req, res));
adminRoutes.patch('/enterprise/zones/:id/toggle', authorizeRole(['SUPER_ADMIN']), (req, res) => AdminScaleController.toggleZone(req, res));
adminRoutes.delete('/enterprise/zones/:id', authorizeRole(['SUPER_ADMIN']), (req, res) => AdminScaleController.deleteZone(req, res));

adminRoutes.get('/enterprise/missions', authorizeRole(['SUPER_ADMIN', 'OPERATOR', 'FINANCE']), (req, res) => AdminScaleController.listMissions(req, res));
adminRoutes.post('/enterprise/missions', authorizeRole(['SUPER_ADMIN']), (req, res) => AdminScaleController.createMission(req, res));
adminRoutes.post('/enterprise/missions/:id/payout', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.payoutQualifiedMission(req, res));

adminRoutes.get('/enterprise/dre', authorizeRole(['SUPER_ADMIN', 'FINANCE']), (req, res) => AdminScaleController.getMonthlyDRE(req, res));
adminRoutes.post('/enterprise/system/backup-now', authorizeRole(['SUPER_ADMIN']), (req, res) => AdminScaleController.triggerSystemSnapshot(req, res));

export { adminRoutes };
export default adminRoutes;
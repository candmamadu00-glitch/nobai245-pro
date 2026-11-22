import { Router } from 'express';
import { B2BPortalController, authenticateB2B } from '../controllers/B2BPortalController';

const b2bRoutes = Router();

b2bRoutes.post('/login', (req, res) => B2BPortalController.login(req, res));
b2bRoutes.get('/me', authenticateB2B, (req, res) => B2BPortalController.getMe(req, res));
b2bRoutes.post('/employees', authenticateB2B, (req, res) => B2BPortalController.addEmployee(req, res));
b2bRoutes.delete('/employees/:empId', authenticateB2B, (req, res) => B2BPortalController.removeEmployee(req, res));
b2bRoutes.post('/estimate', authenticateB2B, (req, res) => B2BPortalController.estimate(req, res));
b2bRoutes.post('/rides/dispatch', authenticateB2B, (req, res) => B2BPortalController.dispatchRide(req, res));
b2bRoutes.get('/rides', authenticateB2B, (req, res) => B2BPortalController.listRides(req, res));
b2bRoutes.post('/rides/:rideId/cancel', authenticateB2B, (req, res) => B2BPortalController.cancelRide(req, res));

export default b2bRoutes;

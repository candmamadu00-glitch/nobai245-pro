import { Router } from 'express';
import { authenticate, authorizeRole } from '../middlewares/authMiddleware';
import { upload } from '../config/multer';
import { 
  requestRide, 
  estimateRidePrice, 
  acceptRide,
  driverArrived,
  startRide,
  finishRide,
  cancelRide, 
  getRideChatHistory, 
  uploadChatAudio,
  rateRide
} from '../controllers/rideController';

const rideRoutes = Router();

// -----------------------------------------------------------------------------
// ROTAS DE PASSAGEIRO
// -----------------------------------------------------------------------------
rideRoutes.post('/request', authenticate, authorizeRole(['PASSENGER']), requestRide);
rideRoutes.post('/estimate', authenticate, estimateRidePrice);

// -----------------------------------------------------------------------------
// ROTAS DE MOTORISTA
// -----------------------------------------------------------------------------
rideRoutes.post('/accept', authenticate, authorizeRole(['DRIVER']), acceptRide);
rideRoutes.post('/:rideId/arrived', authenticate, authorizeRole(['DRIVER']), driverArrived);
rideRoutes.post('/:rideId/start', authenticate, authorizeRole(['DRIVER']), startRide);
rideRoutes.post('/:rideId/finish', authenticate, authorizeRole(['DRIVER']), finishRide);

// -----------------------------------------------------------------------------
// ROTAS COMPARTILHADAS (PASSAGEIRO & MOTORISTA)
// -----------------------------------------------------------------------------
rideRoutes.post('/cancel', authenticate, cancelRide);
rideRoutes.get('/:rideId/chat', authenticate, getRideChatHistory);
rideRoutes.post('/:rideId/chat/audio', authenticate, upload.single('audio'), uploadChatAudio);
rideRoutes.post('/rate', authenticate, rateRide);

export { rideRoutes };
export default rideRoutes;
import { 
  PrismaClient, 
  VehicleType, 
  ServiceType, 
  PaymentMethod, 
  RideStatus, 
  DriverStatus, 
  DocumentType 
} from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Semeando dados completos do NO BAI 245...');

  // 1. Inicializa a Carteira Geral da Empresa
  await prisma.companyWallet.upsert({
    where: { id: 'bai245-main-wallet' },
    update: {},
    create: {
      id: 'bai245-main-wallet',
      balance: 150000.0,
      totalCollected: 500000.0,
    },
  });

  // 2. Configuração de Tarifas em Francos CFA (XOF) para Guiné-Bissau
  const tariffs = [
    // --- TÁXI TRADICIONAL ---
    { vehicleType: VehicleType.TAXI, serviceType: ServiceType.RIDE, baseFare: 300, perKmFare: 250, perMinuteFare: 20, minimumFare: 1000, commissionRate: 10 },
    { vehicleType: VehicleType.TAXI, serviceType: ServiceType.DELIVERY, baseFare: 400, perKmFare: 300, perMinuteFare: 25, minimumFare: 1200, commissionRate: 12 },

    // --- CARRO PARTICULAR ---
    { vehicleType: VehicleType.PARTICULAR, serviceType: ServiceType.RIDE, baseFare: 500, perKmFare: 350, perMinuteFare: 30, minimumFare: 1500, commissionRate: 15 },
    { vehicleType: VehicleType.PARTICULAR, serviceType: ServiceType.DELIVERY, baseFare: 600, perKmFare: 400, perMinuteFare: 35, minimumFare: 1800, commissionRate: 15 },

    // --- MOTO TÁXI ---
    { vehicleType: VehicleType.MOTO, serviceType: ServiceType.RIDE, baseFare: 200, perKmFare: 150, perMinuteFare: 15, minimumFare: 500, commissionRate: 8 },
    { vehicleType: VehicleType.MOTO, serviceType: ServiceType.DELIVERY, baseFare: 250, perKmFare: 200, perMinuteFare: 15, minimumFare: 600, commissionRate: 10 },

    // --- MOTO CARRO (CANDONGA / CARGA) ---
    { vehicleType: VehicleType.MOTO_CARRO, serviceType: ServiceType.DELIVERY, baseFare: 500, perKmFare: 350, perMinuteFare: 25, minimumFare: 1500, commissionRate: 12 },
  ];

  for (const tariff of tariffs) {
    await prisma.tariffConfig.upsert({
      where: {
        vehicleType_serviceType: {
          vehicleType: tariff.vehicleType,
          serviceType: tariff.serviceType,
        },
      },
      update: tariff,
      create: tariff,
    });
  }
  console.log('✅ Tarifas e Carteira da Empresa configuradas com sucesso!');

  // 3. 🛡️ Criação dos Administradores do Sistema
  console.log('🛡️ Criando contas de Super Administradores...');
  const admins = [
    { name: 'Demba', email: 'demba245@nobai.gb', password: 'Demba@Admin2026!', role: 'SUPER_ADMIN' },
    { name: 'Seco', email: 'seco245@nobai.bg', password: 'Seco*Global99!', role: 'SUPER_ADMIN' },
    { name: 'Cande', email: 'cande245@nobai.gw', password: '5800991m', role: 'SUPER_ADMIN' }
  ];

  for (const admin of admins) {
    const passwordHash = await bcrypt.hash(admin.password, 10);

    await prisma.admin.upsert({
      where: { email: admin.email },
      update: {}, 
      create: {
        name: admin.name,
        email: admin.email,
        passwordHash: passwordHash,
        role: admin.role as any,
      },
    });
    console.log(`✅ Administrador [${admin.name}] (${admin.email}) criado com sucesso!`);
  }

  // 4. Passageiros de Teste
  const passHash = await bcrypt.hash('123456', 10);

  const passenger1 = await prisma.passenger.upsert({
    where: { phone: '245955000001' },
    update: {},
    create: {
      fullName: 'Sene Biai',
      phone: '245955000001',
      email: 'sene@gmail.com',
      passwordHash: passHash,
      isVerified: true,
      walletBalance: 25000.00,
    },
  });

  const passenger2 = await prisma.passenger.upsert({
    where: { phone: '245955000002' },
    update: {},
    create: {
      fullName: 'Aissatu Djalo',
      phone: '245955000002',
      email: 'aissatu@gmail.com',
      passwordHash: passHash,
      isVerified: true,
      walletBalance: 10000.00,
    },
  });

  // 5. Motoristas de Teste
  const driver1 = await prisma.driver.upsert({
    where: { phone: '245966000001' },
    update: {},
    create: {
      fullName: 'Malam Bacai',
      phone: '245966000001',
      passwordHash: passHash,
      status: DriverStatus.APPROVED,
      isOnline: true,
      isAvailable: true,
      vehicleType: VehicleType.TAXI,
      vehicleBrand: 'Toyota Corolla',
      vehiclePlate: 'RGB-12-34',
      vehicleColor: 'Amarelo / Azul',
      documentType: DocumentType.BI,
      documentNumber: 'BI-102030',
      walletBalance: 50000.00,
      lastLat: 11.8632,
      lastLng: -15.5843,
    },
  });

  const driver2 = await prisma.driver.upsert({
    where: { phone: '245966000002' },
    update: {},
    create: {
      fullName: 'Inacio Gomes',
      phone: '245966000002',
      passwordHash: passHash,
      status: DriverStatus.APPROVED,
      isOnline: true,
      isAvailable: true,
      vehicleType: VehicleType.PARTICULAR,
      vehicleBrand: 'Hyundai Elantra',
      vehiclePlate: 'RGB-99-88',
      vehicleColor: 'Preto',
      documentType: DocumentType.BI,
      documentNumber: 'BI-405060',
      walletBalance: 12000.00,
      lastLat: 11.8685,
      lastLng: -15.5901,
    },
  });

  // 6. Corridas de Teste (Histórico para o Dashboard)
  console.log('🚗 Gerando corridas de teste...');
  const sampleRides = [
    {
      passengerId: passenger1.id,
      driverId: driver1.id,
      originAddress: 'Praça dos Heróis Nacionais, Bissau',
      originLat: 11.8632,
      originLng: -15.5843,
      destinationAddress: 'Aeroporto Internacional Osvaldo Vieira',
      destinationLat: 11.8901,
      destinationLng: -15.6542,
      priceXof: 3500.00,
      platformFee: 525.00,
      driverEarnings: 2975.00,
      status: RideStatus.COMPLETED,
      paymentMethod: PaymentMethod.ORANGE_MONEY,
      createdAt: new Date(Date.now() - 3600000 * 2),
    },
    {
      passengerId: passenger2.id,
      driverId: driver2.id,
      originAddress: 'Mercado de Bandim, Bissau',
      originLat: 11.8590,
      originLng: -15.5920,
      destinationAddress: 'Bairro de Penha, Bissau',
      destinationLat: 11.8710,
      destinationLng: -15.5780,
      priceXof: 1500.00,
      platformFee: 225.00,
      driverEarnings: 1275.00,
      status: RideStatus.IN_PROGRESS,
      paymentMethod: PaymentMethod.MTN_MOMO,
      createdAt: new Date(Date.now() - 1800000),
    },
    {
      passengerId: passenger1.id,
      driverId: null,
      originAddress: 'Hospital Nacional Simão Mendes',
      originLat: 11.8615,
      originLng: -15.5872,
      destinationAddress: 'Porto de Bissau',
      destinationLat: 11.8530,
      destinationLng: -15.5790,
      priceXof: 2000.00,
      status: RideStatus.SEARCHING,
      paymentMethod: PaymentMethod.CASH,
      createdAt: new Date(),
    },
    {
      passengerId: passenger2.id,
      driverId: driver1.id,
      originAddress: 'Bairro de Ajuda, Bissau',
      originLat: 11.8750,
      originLng: -15.6010,
      destinationAddress: 'Avenida Amílcar Cabral',
      destinationLat: 11.8640,
      destinationLng: -15.5830,
      priceXof: 1800.00,
      status: RideStatus.CANCELLED,
      cancellationReason: 'Passageiro desistiu da viagem',
      cancelledBy: 'PASSENGER' as any,
      paymentMethod: PaymentMethod.WALLET,
      createdAt: new Date(Date.now() - 86400000),
    },
  ];

  for (const ride of sampleRides) {
    await prisma.ride.create({ data: ride });
  }

  console.log('🚀 Semeio concluído com sucesso. Todos os dados prontos!');
}

main()
  .catch((e) => {
    console.error('❌ Erro no Seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendWelcomeEmail = async (to: string, name: string) => {
  try {
    await transporter.sendMail({
      from: `"Equipe App" <${process.env.SMTP_USER}>`,
      to,
      subject: 'Bem-vindo(a) ao nosso App!',
      text: `Olá, ${name}. Seu cadastro foi realizado com sucesso.`,
      html: `<h3>Olá, ${name}!</h3><p>Seu cadastro foi realizado com sucesso. Estamos felizes em ter você conosco.</p>`,
    });
  } catch (error) {
    console.error('❌ [EMAIL SERVIÇO]: Erro ao enviar e-mail de boas-vindas:', error);
  }
};
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";

// CNP: trava simples em memória contra tentativa de senha por força bruta.
const MAX_FALHAS = 5;
const JANELA_MS = 15 * 60 * 1000;
const tentativas = new Map<string, { falhas: number; desde: number }>();
function loginBloqueado(email: string): boolean {
  const t = tentativas.get(email.toLowerCase());
  if (!t) return false;
  if (Date.now() - t.desde > JANELA_MS) { tentativas.delete(email.toLowerCase()); return false; }
  return t.falhas >= MAX_FALHAS;
}
function registrarFalha(email: string): void {
  const k = email.toLowerCase();
  const t = tentativas.get(k);
  if (!t || Date.now() - t.desde > JANELA_MS) tentativas.set(k, { falhas: 1, desde: Date.now() });
  else t.falhas++;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          // CNP: limite de tentativas por e-mail (5 erros = 15 min bloqueado)
          if (loginBloqueado(email)) return null;

          const user = await prisma.user.findUnique({ where: { email } });
          if (!user) { registrarFalha(email); return null; }

          const passwordsMatch = await bcrypt.compare(password, user.password);

          if (passwordsMatch) {
             tentativas.delete(email.toLowerCase());
             return user;
          }
          registrarFalha(email);
        }
        return null;
      },
    }),
  ],
  secret: process.env.AUTH_SECRET,
});

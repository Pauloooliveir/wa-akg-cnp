import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
});

export async function POST(req: Request) {
    // CNP: cadastro público sempre fechado; o admin é criado no deploy (ADMIN_EMAIL/ADMIN_PASSWORD).
    if (process.env.ALLOW_REGISTRATION !== "true") {
        return NextResponse.json({ error: "Registration is disabled" }, { status: 403 });
    }
    try {
        const body = await req.json();
        const { email, password, name } = registerSchema.parse(body);

        // Check user count to allow first user as SUPERADMIN
        const userCount = await prisma.user.count();

        if (userCount > 0) {
            // Check if registration is enabled
            const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
            if (!systemConfig || systemConfig.enableRegistration !== true) {
                return NextResponse.json(
                    { error: "Registration is currently disabled by the administrator" },
                    { status: 403 }
                );
            }
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: "User with this email already exists" },
                { status: 400 }
            );
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // First user becomes SUPERADMIN, subsequent users are USER (least privilege)
        const assignedRole = userCount === 0 ? "SUPERADMIN" : "USER";

        // Create the user
        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: assignedRole as any,
            },
        });

        return NextResponse.json({
            success: true,
            message: "User registered successfully",
            user: { id: newUser.id, name: newUser.name, email: newUser.email },
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid registration data provided" },
                { status: 400 }
            );
        }

        console.error("Registration error:", error);
        return NextResponse.json(
            { error: "Internal server error during registration" },
            { status: 500 }
        );
    }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: z.string().min(1).max(39).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;
  const username = parsed.data.username ?? email.split("@")[0];

  // Pre-check for a clear 409. The DB unique constraint remains the source of
  // truth for the concurrent-registration race handled below.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const hashed = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: { email, username, password: hashed, role: Role.VIEWER },
      select: { id: true, email: true, username: true, role: true, createdAt: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (e) {
    // P2002 = unique constraint violation. Two requests can pass the pre-check
    // above simultaneously; the second insert loses the race and lands here.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined)?.join(", ") ?? "field";
      const isEmail = typeof target === "string" && target.includes("email");
      return NextResponse.json(
        { error: isEmail ? "Email already registered" : `Duplicate ${target}` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

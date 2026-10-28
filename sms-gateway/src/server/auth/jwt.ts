import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";

const key = () => new TextEncoder().encode(config.JWT_SECRET);

export function signToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(config.JWT_EXPIRES_IN)
    .sign(key());
}

export async function verifyToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
  if (!payload.sub) throw new Error("Token has no subject");
  return payload.sub;
}

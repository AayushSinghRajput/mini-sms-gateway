// Minimal root layout (API-only app). Next.js requires one to build.
export const metadata = { title: "Mini SMS Gateway" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

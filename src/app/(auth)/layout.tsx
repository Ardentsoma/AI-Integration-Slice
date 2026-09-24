import { ToastProvider } from "@/components/toast";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <main className="flex min-h-screen w-full">{children}</main>
    </ToastProvider>
  );
}
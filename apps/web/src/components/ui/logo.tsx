export function Logo({ className = 'text-18' }: { className?: string }) {
  return (
    <div className={`font-display ${className}`}>
      Reply<b className="font-normal text-accent">Desk</b>
    </div>
  );
}

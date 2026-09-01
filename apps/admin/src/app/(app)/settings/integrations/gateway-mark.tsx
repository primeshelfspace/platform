import type { PaymentGatewayProvider } from '@/lib/api';

/**
 * Each payment gateway's own brand mark — recognisable colours/shapes for
 * Stripe, PayPal, Square and Authorize.net, so a card reads as "that
 * gateway" at a glance instead of a generic lettered badge. Sized to
 * whichever card it sits in: the Payment Gateways list/detail rows ('md'),
 * or a standalone header like Zoho's own or the Integrations tab's Square
 * card ('lg').
 */
export function GatewayMark({
  provider,
  size = 'md',
}: {
  provider: PaymentGatewayProvider;
  size?: 'md' | 'lg';
}) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-10 w-10 rounded-lg';

  if (provider === 'STRIPE') {
    return (
      <span className={`flex ${box} shrink-0 items-center justify-center bg-[#635BFF]`} aria-hidden>
        <span
          className={`font-bold italic text-white ${size === 'lg' ? 'text-[15px]' : 'text-[13px]'}`}
        >
          stripe
        </span>
      </span>
    );
  }

  if (provider === 'PAYPAL') {
    return (
      <span
        className={`relative flex ${box} shrink-0 items-center justify-center border border-border bg-white`}
        aria-hidden
      >
        <span
          className={`absolute translate-x-[1.5px] translate-y-[1.5px] font-black text-[#009cde] ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}
        >
          P
        </span>
        <span className={`relative font-black text-[#003087] ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>
          P
        </span>
      </span>
    );
  }

  if (provider === 'SQUARE') {
    return (
      <span className={`flex ${box} shrink-0 items-center justify-center bg-black`} aria-hidden>
        <span className={`rounded-[5px] border-2 border-white ${size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'}`} />
      </span>
    );
  }

  // AUTHORIZE_NET
  return (
    <span className={`relative flex ${box} shrink-0 items-center justify-center bg-[#0F4C9B]`} aria-hidden>
      <span className={`font-bold text-white ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>a</span>
      <span
        className={`absolute rounded-full bg-[#F5A623] ${size === 'lg' ? 'right-2 top-2.5 h-1.5 w-1.5' : 'right-1.5 top-2 h-1 w-1'}`}
      />
    </span>
  );
}

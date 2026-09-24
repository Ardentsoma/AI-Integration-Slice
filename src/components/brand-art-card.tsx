import Image from "next/image";

/**
 * The brand-side visual shown on the sign-in / create-account split screens.
 * The card's aspect ratio matches the source PNG (2004x2544), so with
 * object-cover the whole image is always visible — nothing cropped, no
 * letterboxing — at mobile and desktop widths.
 */
export default function BrandArtCard() {
  return (
    <div className="relative mx-auto aspect-[2265/2544] w-[92%] max-w-[380px] flex-shrink-0 self-center overflow-hidden rounded-3xl bg-neutral-900 md:ml-[110px] md:max-w-[607px]">
      <Image
        src="/images/side-screen-v2.png"
        alt="SCOPE - a preview of the product"
        fill
        priority
        sizes="(min-width: 768px) 50vw, 100vw"
        className="object-contain"
      />
    </div>
  );
}
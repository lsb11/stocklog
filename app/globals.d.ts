declare module "*.css";

interface ShopifyResourcePickerVariant {
  id: string;
  sku: string;
  product: { id: string; title: string };
}

interface ShopifyToast {
  show(message: string, options?: { duration?: number; isError?: boolean }): void;
  hide(): void;
}

interface ShopifyGlobal {
  toast: ShopifyToast;
  resourcePicker(options: {
    type: "variant" | "product" | "collection";
    multiple?: boolean;
  }): Promise<ShopifyResourcePickerVariant[] | undefined>;
}

declare const shopify: ShopifyGlobal;

declare module "*.css";

interface ShopifyResourcePickerVariant {
  id: string;
  sku: string;
  product: { id: string; title: string };
}

interface ShopifyGlobal {
  resourcePicker(options: {
    type: "variant" | "product" | "collection";
    multiple?: boolean;
  }): Promise<ShopifyResourcePickerVariant[] | undefined>;
}

declare const shopify: ShopifyGlobal;

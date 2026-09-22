declare module "*.css";

interface ShopifyResourcePickerVariant {
  id: string;
  title?: string;
  sku?: string;
  product?: { id: string; title: string };
}

interface ShopifyResourcePickerProduct {
  id: string;
  title: string;
  /**
   * With `filter: { variants: true }` the picker returns the variants the
   * merchant expanded and selected; selecting the product row itself returns
   * all of them.
   */
  variants?: ShopifyResourcePickerVariant[];
}

interface ShopifyToast {
  show(message: string, options?: { duration?: number; isError?: boolean }): void;
  hide(): void;
}

interface ShopifyGlobal {
  toast: ShopifyToast;
  resourcePicker(options: {
    type: "variant" | "product" | "collection";
    action?: "select" | "add";
    multiple?: boolean;
    filter?: { variants?: boolean; draft?: boolean; archived?: boolean };
  }): Promise<
    Array<ShopifyResourcePickerProduct | ShopifyResourcePickerVariant> | undefined
  >;
}

declare const shopify: ShopifyGlobal;

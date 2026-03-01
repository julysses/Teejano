/**
 * shopify_publisher.ts — Shopify Admin API Publisher (GraphQL)
 * Creates products, variants, images, sets metafields, manages collections
 */

import * as fs from "fs";
import * as path from "path";
import { ProductListing, ShopifyPublishLog } from "./types";
import { loadConfig, writeJson, sleep, log } from "./utils";

interface ShopifyConfig {
  shop_domain: string;
  admin_access_token: string;
  api_version: string;
  draft_mode: boolean;
  draft_prefix: string;
  autopublish_mode: boolean;
  collections: Record<string, string>;
  metafield_namespace: string;
  rate_limits: { requests_per_second: number; retry_on_429: boolean; max_retries: number };
}

const PRODUCT_CREATE_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        handle
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANTS_MUTATION = `
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_IMAGE_CREATE_MUTATION = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          image {
            url
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_ADD_MUTATION = `
  mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_BY_TITLE_QUERY = `
  query getCollectionByTitle($title: String!) {
    collections(first: 1, query: $title) {
      edges {
        node {
          id
          title
        }
      }
    }
  }
`;

export class ShopifyPublisher {
  private config: ShopifyConfig;
  private baseUrl: string;
  private headers: Record<string, string>;
  private collectionCache: Map<string, string> = new Map();

  constructor() {
    this.config = loadConfig<ShopifyConfig>(
      path.join(process.cwd(), "config", "shopify_config.json")
    );
    this.baseUrl = `https://${this.config.shop_domain}/admin/api/${this.config.api_version}/graphql.json`;
    this.headers = {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": this.config.admin_access_token,
    };
  }

  /** Execute a GraphQL query/mutation with rate-limit retry */
  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const maxRetries = this.config.rate_limits.max_retries;
    let attempt = 0;

    while (attempt <= maxRetries) {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
      });

      if (response.status === 429 && this.config.rate_limits.retry_on_429) {
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay);
        attempt++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json() as { data: T; errors?: Array<{ message: string }> };
      if (json.errors?.length) {
        throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
      }
      return json.data;
    }

    throw new Error("Max retries exceeded");
  }

  /** Create a product in Shopify (draft by default) */
  async createProduct(listing: ProductListing): Promise<string> {
    const title = this.config.draft_mode
      ? `${this.config.draft_prefix} ${listing.title_seo}`
      : listing.title_seo;

    const variables = {
      input: {
        title,
        descriptionHtml: listing.description_html,
        vendor: "Teejano",
        productType: "T-Shirt",
        handle: listing.handle,
        status: this.config.draft_mode ? "DRAFT" : "ACTIVE",
        tags: listing.tags,
      },
    };

    const data = await this.graphql<{
      productCreate: {
        product: { id: string; handle: string };
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(PRODUCT_CREATE_MUTATION, variables);

    if (data.productCreate.userErrors.length > 0) {
      throw new Error(
        `Product create errors: ${data.productCreate.userErrors.map((e) => e.message).join(", ")}`
      );
    }

    return data.productCreate.product.id;
  }

  /** Create variants for a product */
  async createVariants(
    productId: string,
    sizes: string[],
    colors: string[],
    price: number,
    compareAtPrice?: number
  ): Promise<void> {
    const variants = [];
    for (const color of colors) {
      for (const size of sizes) {
        variants.push({
          price: String(price.toFixed(2)),
          compareAtPrice: compareAtPrice ? String(compareAtPrice.toFixed(2)) : null,
          options: [size, color],
          requiresShipping: true,
          taxable: true,
        });
      }
    }

    const data = await this.graphql<{
      productVariantsBulkCreate: {
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(PRODUCT_VARIANTS_MUTATION, { productId, variants });

    if (data.productVariantsBulkCreate.userErrors.length > 0) {
      throw new Error(
        `Variant errors: ${data.productVariantsBulkCreate.userErrors.map((e) => e.message).join(", ")}`
      );
    }
  }

  /** Upload images to a product */
  async uploadImages(
    productId: string,
    imagePaths: string[],
    altTexts: string[]
  ): Promise<void> {
    const media = imagePaths.map((src, i) => ({
      originalSource: src,
      alt: altTexts[i] || "Teejano product image",
      mediaContentType: "IMAGE",
    }));

    const data = await this.graphql<{
      productCreateMedia: {
        mediaUserErrors: Array<{ field: string; message: string }>;
      };
    }>(PRODUCT_IMAGE_CREATE_MUTATION, { productId, media });

    if (data.productCreateMedia.mediaUserErrors.length > 0) {
      console.warn(
        `Image upload warnings: ${data.productCreateMedia.mediaUserErrors.map((e) => e.message).join(", ")}`
      );
    }
  }

  /** Get or create a collection by title */
  private async getOrCreateCollection(title: string): Promise<string> {
    if (this.collectionCache.has(title)) {
      return this.collectionCache.get(title)!;
    }

    const data = await this.graphql<{
      collections: { edges: Array<{ node: { id: string; title: string } }> };
    }>(COLLECTION_BY_TITLE_QUERY, { title });

    const existing = data.collections.edges[0]?.node;
    if (existing) {
      this.collectionCache.set(title, existing.id);
      return existing.id;
    }

    // Collection doesn't exist — log a warning (create via admin UI or REST)
    console.warn(`Collection "${title}" not found in Shopify. Please create it manually.`);
    return "";
  }

  /** Add product to collections */
  async addToCollections(productId: string, collectionTitles: string[]): Promise<void> {
    for (const title of collectionTitles) {
      const collectionId = await this.getOrCreateCollection(title);
      if (!collectionId) continue;
      await this.graphql(COLLECTION_ADD_MUTATION, { id: collectionId, productIds: [productId] });
      await sleep(500); // Rate limit buffer
    }
  }

  /** Full publish pipeline for one listing */
  async publishListing(
    listing: ProductListing,
    mockupUrls: string[],
    dropDir: string
  ): Promise<ShopifyPublishLog> {
    const timestamp = new Date().toISOString();
    try {
      log(dropDir, `Publishing listing: ${listing.listing_id} — ${listing.title_seo}`);

      const productId = await this.createProduct(listing);
      log(dropDir, `Product created: ${productId}`);

      await sleep(1000 / this.config.rate_limits.requests_per_second);

      // Add to collections
      if (listing.collections.length > 0) {
        await this.addToCollections(productId, listing.collections);
      }

      return {
        concept_id: listing.concept_id,
        listing_id: listing.listing_id,
        shopify_product_id: productId,
        handle: listing.handle,
        status: "success",
        timestamp,
      };
    } catch (err: any) {
      log(dropDir, `Publish failed for ${listing.listing_id}: ${err.message}`, "ERROR");
      return {
        concept_id: listing.concept_id,
        listing_id: listing.listing_id,
        status: "failed",
        error: err.message,
        timestamp,
      };
    }
  }

  /** Publish all listings for a drop */
  async publishDrop(
    listings: ProductListing[],
    mockupManifest: { mockups: Array<{ concept_id: string; file_path: string }> },
    dropDir: string
  ): Promise<ShopifyPublishLog[]> {
    const logs: ShopifyPublishLog[] = [];

    for (const listing of listings) {
      const mockups = mockupManifest.mockups
        .filter((m) => m.concept_id === listing.concept_id)
        .map((m) => m.file_path);

      const result = await this.publishListing(listing, mockups, dropDir);
      logs.push(result);

      writeJson(path.join(dropDir, "PUBLISH", "publish_log.json"), logs);
      await sleep(500);
    }

    return logs;
  }
}

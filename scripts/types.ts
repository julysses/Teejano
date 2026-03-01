// Teejano Agency — Shared Types

export type ConceptStatus =
  | "draft"
  | "approved"
  | "rejected"
  | "in_design"
  | "ready_for_listing"
  | "live"
  | "archived";

export type AssetStatus =
  | "brief_ready"
  | "in_progress"
  | "needs_revision"
  | "final_ready";

export type ListingStatus = "draft" | "queued" | "published" | "paused" | "retired";

export type CampaignType = "ig_reel" | "tiktok" | "email" | "sms" | "influencer" | "paid_social";

export type HumorAngle =
  | "self_deprecating_texas"
  | "outsider_vs_texan"
  | "texas_pride_deadpan"
  | "gym_cowboy_crossover"
  | "tejano_cultural"
  | "weather_geography"
  | "food_bbq"
  | "sports_generic";

export type BilingualLevel = "none" | "light" | "medium";

export type LaunchType = "evergreen" | "drop" | "seasonal";

export interface ConceptVariant {
  label: string;
  phrase: string;
  color_suggestion: string;
}

export interface DesignConcept {
  concept_id: string;
  created_at: string;
  created_by: "ai" | "human";
  status: ConceptStatus;
  category: string;
  sub_category?: string;
  city?: string;
  neighborhood?: string;
  audience: string;
  hook: string;
  phrase_primary: string;
  phrase_alt_1?: string;
  phrase_alt_2?: string;
  imagery_notes?: string;
  style_tags: string[];
  bilingual_level: BilingualLevel;
  risk_flags: string[];
  uniqueness_score: number;
  sell_thesis: string;
  seasonality?: string;
  priority: number;
  angle: HumorAngle;
  variants: ConceptVariant[];
  score?: ScoredConcept["scores"];
  total_score?: number;
}

export interface ScoredConcept extends DesignConcept {
  scores: {
    clarity: number;
    texas_ness: number;
    humor_punch: number;
    wearability: number;
    print_simplicity: number;
  };
  total_score: number;
  disqualified: boolean;
  disqualify_reason?: string;
}

export interface DesignBrief {
  asset_id: string;
  concept_id: string;
  week: string;
  created_at: string;
  status: AssetStatus;
  designer: "ai" | "human";
  variant_label: string;
  phrase: string;
  layout_map: {
    layout_type: "stacked" | "arched" | "badge" | "single_line" | "condensed_block";
    font_primary: string;
    font_secondary?: string;
    hierarchy: string;
  };
  fonts: string[];
  colorways: {
    garment_color: string;
    garment_hex: string;
    ink_colors: Array<{ name: string; hex: string }>;
    spot_count: number;
  };
  print_specs: {
    placement: string;
    width_inches: number;
    height_inches: number;
    front_back: "front_only" | "back_only" | "front_and_back" | "pocket_and_back";
    min_stroke_pt: number;
    no_gradients: boolean;
    spot_colors: number;
  };
  icon_notes: string;
  mockup_brief: {
    primary: string;
    secondary: string;
  };
  notes?: string;
}

export interface ProductListing {
  listing_id: string;
  concept_id: string;
  asset_id: string;
  created_at: string;
  status: ListingStatus;
  shopify_product_id?: string;
  title_seo: string;
  description_html: string;
  meta_description: string;
  collections: string[];
  tags: string[];
  handle: string;
  price: number;
  compare_at_price?: number;
  mockup_urls: string[];
  primary_image_url?: string;
  alt_texts: Record<string, string>;
  launch_type: LaunchType;
  launch_date?: string;
  notes?: string;
}

export interface MarketingPack {
  listing_id: string;
  concept_id: string;
  week: string;
  instagram: {
    caption_drop_day: string;
    caption_teaser: string;
    caption_last_call: string;
    hashtags: string[];
  };
  tiktok: {
    script: string;
    caption: string;
    trending_sound_note: string;
  };
  email: {
    teaser_subject_options: string[];
    teaser_preview_text: string;
    drop_live_subject_options: string[];
    drop_live_preview_text: string;
    last_call_subject_options: string[];
    last_call_preview_text: string;
    drop_live_body_text: string;
  };
  sms: {
    drop_live: string;
    last_call: string;
  };
  influencer_outreach: {
    dm_script: string;
    target_profile: string;
  };
  utm_parameters: Record<string, string>;
}

export interface CoworkInput {
  CONCEPT_ID: string;
  PHRASE: string;
  ANGLE: string;
  VISUAL_HOOK: string;
  TARGET: string;
  VARIANTS: Array<{ label: string; phrase: string; color_suggestion: string }>;
  NOTES: string;
}

export interface WeeklyDropState {
  week: string;
  drop_dir: string;
  phase:
    | "init"
    | "cowork_prompts"
    | "awaiting_cowork"
    | "scoring"
    | "briefs"
    | "listings"
    | "marketing"
    | "mockups"
    | "shopify_staging"
    | "awaiting_approval"
    | "published"
    | "postmortem";
  finalists: ScoredConcept[];
  briefs: DesignBrief[];
  listings: ProductListing[];
  marketing_packs: MarketingPack[];
  mockup_manifest: MockupManifest;
  publish_log: ShopifyPublishLog[];
}

export interface MockupResult {
  concept_id: string;
  design_slug: string;
  variant_label: string;
  mockup_type: "front_on_model" | "flatlay" | "detail";
  blank: string;
  color: string;
  file_path: string;
  export_size: string;
  status: "generated" | "failed" | "placeholder";
}

export interface MockupManifest {
  week: string;
  generated_at: string;
  mockups: MockupResult[];
}

export interface ShopifyPublishLog {
  concept_id: string;
  listing_id: string;
  shopify_product_id?: string;
  handle?: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  timestamp: string;
}

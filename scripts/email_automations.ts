/**
 * email_automations.ts — Email/SMS Automation
 * Primary: Klaviyo API — Fallback: Shopify Email export pack
 */

import * as path from "path";
import * as fs from "fs";
import { MarketingPack, ProductListing } from "./types";
import { loadConfig, writeJson, sleep, log, slugify } from "./utils";

interface EmailConfig {
  primary_provider: string;
  klaviyo: {
    private_key: string;
    list_id_all_subscribers: string;
    list_id_engaged: string;
    from_email: string;
    from_name: string;
    reply_to: string;
    utm_source: string;
    utm_medium: string;
  };
  sms: {
    provider: string;
    api_key: string;
    brand_name: string;
    opt_out_text: string;
  };
  weekly_sequence: Record<string, { day: string; time: string; timezone: string; subject_tone: string; optional?: boolean }>;
}

/** Klaviyo API client */
class KlaviyoClient {
  private apiKey: string;
  private baseUrl = "https://a.klaviyo.com/api";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        "Authorization": `Klaviyo-API-Key ${this.apiKey}`,
        "Content-Type": "application/json",
        "revision": "2024-02-15",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Klaviyo API error ${response.status}: ${text}`);
    }
    return response.json() as T;
  }

  async createCampaignDraft(params: {
    name: string;
    subject: string;
    preview_text: string;
    from_email: string;
    from_name: string;
    reply_to: string;
    html: string;
    list_id: string;
  }): Promise<string> {
    const data = await this.request<{ data: { id: string } }>("POST", "/campaigns/", {
      data: {
        type: "campaign",
        attributes: {
          name: params.name,
          audiences: {
            included: [params.list_id],
          },
          send_options: { use_smart_sending: true },
          tracking_options: { is_tracking_clicks: true, is_tracking_opens: true },
          send_strategy: { method: "immediate" },
        },
        relationships: {
          "campaign-messages": {
            data: [{
              type: "campaign-message",
              attributes: {
                definition: {
                  type: "email",
                  subject: params.subject,
                  preview_text: params.preview_text,
                  reply_to_email: params.reply_to,
                  from_email: params.from_email,
                  from_label: params.from_name,
                },
                content: { html: params.html },
              },
            }],
          },
        },
      },
    });
    return data.data.id;
  }

  async scheduleCampaign(campaignId: string, sendAt: string): Promise<void> {
    await this.request("POST", `/campaign-send-jobs/`, {
      data: {
        type: "campaign-send-job",
        attributes: { scheduled_at: sendAt },
        relationships: {
          campaign: { data: { type: "campaign", id: campaignId } },
        },
      },
    });
  }
}

/** Generate mobile-first HTML email template */
function buildEmailHtml(params: {
  heading: string;
  body: string;
  cta_text: string;
  cta_url: string;
  preview_phrase?: string;
  theme?: "dark" | "light";
}): string {
  const bg = params.theme === "light" ? "#F5F0E8" : "#0F0F0F";
  const text = params.theme === "light" ? "#1A1A1A" : "#FFFFFF";
  const subtext = params.theme === "light" ? "#555555" : "#AAAAAA";
  const cta_bg = "#C8102E";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Teejano</title>
</head>
<body style="margin:0;padding:0;background-color:${bg};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${bg};">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-size:28px;font-weight:900;color:${text};letter-spacing:2px;text-transform:uppercase;">TEEJANO</span>
        </td></tr>
        <!-- Heading -->
        <tr><td align="center" style="padding-bottom:24px;">
          <h1 style="margin:0;font-size:36px;font-weight:900;color:${text};line-height:1.1;text-transform:uppercase;">${params.heading}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td align="center" style="padding-bottom:32px;">
          <p style="margin:0;font-size:16px;color:${subtext};line-height:1.6;max-width:480px;">${params.body}</p>
        </td></tr>
        <!-- CTA -->
        <tr><td align="center" style="padding-bottom:40px;">
          <a href="${params.cta_url}" style="display:inline-block;background-color:${cta_bg};color:#FFFFFF;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;text-transform:uppercase;letter-spacing:1px;border-radius:2px;">${params.cta_text}</a>
        </td></tr>
        <!-- Footer -->
        <tr><td align="center">
          <p style="margin:0;font-size:12px;color:${subtext};">Texas-made. Bold by default. &copy; Teejano</p>
          <p style="margin:8px 0 0;font-size:11px;color:${subtext};">You're receiving this because you subscribed at teejano.com<br><a href="{{unsubscribe_url}}" style="color:${subtext};">Unsubscribe</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Generate the full email sequence for a drop */
export function generateEmailSequence(
  week: string,
  dropName: string,
  topPhrases: string[],
  storeUrl: string,
  dropDir: string
): void {
  const config = loadConfig<EmailConfig>(path.join(process.cwd(), "config", "email_config.json"));
  const utmBase = `utm_source=${config.klaviyo.utm_source}&utm_medium=${config.klaviyo.utm_medium}&utm_campaign=drop-${week}`;
  const shopUrl = `${storeUrl}?${utmBase}`;

  const emails = [
    {
      name: "01_teaser",
      schedule: config.weekly_sequence.teaser,
      subjects: [
        `Something's dropping Friday, Texas 👀`,
        `New Teejano drop incoming — Wed preview`,
        `Big week. Don't sleep.`,
      ],
      preview: "A fresh drop hits Friday. Here's your early look.",
      heading: "Friday. New Drop.",
      body: `Something's coming. We're not saying what yet.<br><br>Check back Friday morning when the new Teejano drop goes live. Texas-made. Bold as always.`,
      cta: "Shop Teejano",
      cta_url: `${storeUrl}?${utmBase}&utm_content=teaser`,
      theme: "dark" as const,
    },
    {
      name: "02_drop_live",
      schedule: config.weekly_sequence.drop_live,
      subjects: [
        `Drop is LIVE — ${topPhrases[0] ?? "new designs"}`,
        `Texas just got bolder. New Teejano drop.`,
        `It's Friday. You know what that means.`,
      ],
      preview: "New designs just dropped. Get yours before they're gone.",
      heading: "Drop Is Live.",
      body: `Fresh designs. Bold as Texas.<br><br>${topPhrases.slice(0, 3).map((p) => `<strong>${p}</strong>`).join(" &bull; ")}<br><br>Limited run. Once they're gone, they're gone.`,
      cta: "Shop The Drop →",
      cta_url: `${storeUrl}collections/weekly-drops?${utmBase}&utm_content=drop-live`,
      theme: "dark" as const,
    },
    {
      name: "03_last_call",
      schedule: config.weekly_sequence.last_call,
      subjects: [
        `Last call — drop closes tonight`,
        `Still here? This drop won't be.`,
        `${topPhrases[0] ?? "These designs"} won't last`,
      ],
      preview: "Drop closes soon. Don't miss it.",
      heading: "Last Call.",
      body: `This week's drop is wrapping up. If you've been eyeing anything — now's the time.<br><br>Limited run. No restocks.`,
      cta: "Grab It Now",
      cta_url: `${storeUrl}collections/weekly-drops?${utmBase}&utm_content=last-call`,
      theme: "dark" as const,
    },
    {
      name: "04_winner_recap",
      schedule: config.weekly_sequence.winner_recap,
      subjects: [
        `Texas spoke. Here's what won.`,
        `Best sellers from this week's drop`,
        `The people have decided.`,
      ],
      preview: "Here's what the Teejano community grabbed this week.",
      heading: "The People Have Spoken.",
      body: `This week's drop is officially closed. Here's what Texas gravitated toward.<br><br>Next drop hits Friday. Stay locked.`,
      cta: "See What's Left",
      cta_url: `${storeUrl}?${utmBase}&utm_content=recap`,
      theme: "dark" as const,
    },
  ];

  const outputDir = path.join(dropDir, "04_MARKETING", "email_sequence");
  fs.mkdirSync(outputDir, { recursive: true });

  for (const email of emails) {
    const html = buildEmailHtml({
      heading: email.heading,
      body: email.body,
      cta_text: email.cta,
      cta_url: email.cta_url,
      theme: email.theme,
    });

    fs.writeFileSync(path.join(outputDir, `${email.name}.html`), html);
    fs.writeFileSync(
      path.join(outputDir, `${email.name}_meta.json`),
      JSON.stringify({
        name: email.name,
        week,
        schedule: email.schedule,
        subject_options: email.subjects,
        preview_text: email.preview,
        cta_url: email.cta_url,
      }, null, 2)
    );

    const plain = `${email.heading}\n\n${email.body.replace(/<[^>]+>/g, "")}\n\n${email.cta}: ${email.cta_url}`;
    fs.writeFileSync(path.join(outputDir, `${email.name}_plain.txt`), plain);
  }

  log(dropDir, `Email sequence generated: ${emails.length} emails in ${outputDir}`);
}

/** Schedule emails via Klaviyo if API key is present */
export async function scheduleKlaviyoSequence(
  week: string,
  dropDir: string
): Promise<void> {
  const config = loadConfig<EmailConfig>(path.join(process.cwd(), "config", "email_config.json"));
  if (!config.klaviyo.private_key || config.klaviyo.private_key.startsWith("${")) {
    log(dropDir, "Klaviyo API key not configured — skipping scheduling. Use export pack instead.", "WARN");
    generateShopifyEmailExportInstructions(week, dropDir);
    return;
  }

  const client = new KlaviyoClient(config.klaviyo.private_key);
  const emailDir = path.join(dropDir, "04_MARKETING", "email_sequence");
  const emails = ["01_teaser", "02_drop_live", "03_last_call", "04_winner_recap"];

  for (const name of emails) {
    const metaPath = path.join(emailDir, `${name}_meta.json`);
    const htmlPath = path.join(emailDir, `${name}.html`);
    if (!fs.existsSync(metaPath) || !fs.existsSync(htmlPath)) continue;

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const html = fs.readFileSync(htmlPath, "utf-8");

    try {
      const campaignId = await client.createCampaignDraft({
        name: `Teejano Drop ${week} — ${meta.name}`,
        subject: meta.subject_options[0],
        preview_text: meta.preview_text,
        from_email: config.klaviyo.from_email,
        from_name: config.klaviyo.from_name,
        reply_to: config.klaviyo.from_email,
        html,
        list_id: config.klaviyo.list_id_all_subscribers,
      });
      log(dropDir, `Klaviyo draft created: ${name} — ID: ${campaignId}`);
      await sleep(500);
    } catch (err: any) {
      log(dropDir, `Klaviyo create failed for ${name}: ${err.message}`, "ERROR");
    }
  }
}

/** Generate Shopify Email fallback instructions */
function generateShopifyEmailExportInstructions(week: string, dropDir: string): void {
  const instructions = `# Shopify Email / Mailchimp Import Instructions
## Drop Week: ${week}

Since Klaviyo is not configured, use the HTML files in this folder with Shopify Email or Mailchimp.

### Steps:
1. In Shopify Admin → Marketing → Campaigns → Create Campaign
2. Choose "Email" type
3. For each email file below, copy/paste the HTML into the email editor:
   - \`01_teaser.html\` — Send Wednesday 10:00 AM CT
   - \`02_drop_live.html\` — Send Friday 9:00 AM CT
   - \`03_last_call.html\` — Send Sunday 12:00 PM CT
   - \`04_winner_recap.html\` — Send Tuesday 10:00 AM CT (optional)

4. Use subject options from the corresponding \`_meta.json\` files.
5. Replace all \`{{unsubscribe_url}}\` with Shopify's unsubscribe variable.

### Mailchimp CSV Import:
- Export your subscriber list from Shopify
- Import into Mailchimp as a CSV
- Use the HTML files as custom coded templates

`;
  fs.writeFileSync(path.join(dropDir, "04_MARKETING", "email_sequence", "IMPORT_INSTRUCTIONS.md"), instructions);
}

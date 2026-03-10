export type ForkConfigItem = {
  name: string;
  type: "collection" | "file";
  label: string;
  href: string;
};

export type ForkSiteMeta = {
  name: string;
  slug: string;
  siteHref: string;
  shopHref: string;
};

export type ForkConfig = {
  owner: string;
  repo: string;
  branch: string;
  sha: string;
  version: string;
  object: {
    content: ForkConfigItem[];
    settings?: {
      hide?: boolean;
      href: string;
      label?: string;
    };
    site: ForkSiteMeta;
  };
};

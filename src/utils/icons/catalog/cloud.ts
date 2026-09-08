import {
  Cloud,
  CloudCog,
  CloudDownload,
  CloudLightning,
  CloudUpload,
} from "lucide-react";

import {
  alibabacloud,
  azure,
  digitalocean,
  googlecloud,
  hetzner,
  ibm,
  linode,
  oracle,
  ovh,
  redhat,
  tencentcloud,
  heroku,
  scaleway,
} from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

export const CLOUD_ICONS = [
  defineIcon("heroku", "Heroku", "cloud", heroku, ["heroku", "cloud", "paas"]),
  defineIcon("scaleway", "Scaleway", "cloud", scaleway, [
    "scaleway",
    "cloud",
    "hosting",
  ]),
  defineIcon("cloud", "Cloud", "cloud", Cloud, ["azure", "gcp", "provider"]),
  defineIcon("cloud-cog", "Managed cloud", "cloud", CloudCog, [
    "cloud admin",
    "service",
  ]),
  defineIcon("cloud-upload", "Cloud upload", "cloud", CloudUpload, [
    "upload",
    "sync",
  ]),
  defineIcon("cloud-download", "Cloud download", "cloud", CloudDownload, [
    "download",
    "sync",
  ]),
  defineIcon("cloud-lightning", "Cloud compute", "cloud", CloudLightning, [
    "compute",
    "serverless",
  ]),
  defineIcon("googlecloud", "Google Cloud", "cloud", googlecloud, [
    "gcp",
    "google cloud",
    "cloud platform",
  ]),
  defineIcon("azure", "Microsoft Azure", "cloud", azure, [
    "azure",
    "microsoft cloud",
    "cloud platform",
  ]),
  defineIcon(
    "hetzner-cloud",
    "Hetzner Cloud",
    "cloud",
    createRoleIcon("HetznerCloud", "cloud", hetzner),
    ["hetzner", "hetzenr", "hetznercloud", "cloud hosting", "vps"],
  ),
  defineIcon(
    "ovh-cloud",
    "OVHcloud",
    "cloud",
    createRoleIcon("OVHCloud", "cloud", ovh),
    ["ovh", "ovhcloud", "ovh cloud", "hosting", "vps"],
  ),
  defineIcon(
    "digitalocean-cloud",
    "DigitalOcean",
    "cloud",
    createRoleIcon("DigitalOceanCloud", "cloud", digitalocean),
    ["digitalocean", "digital ocean", "droplet", "cloud"],
  ),
  defineIcon(
    "oracle-cloud",
    "Oracle Cloud",
    "cloud",
    createRoleIcon("OracleCloud", "cloud", oracle),
    ["oracle", "oraclecloud", "oci", "cloud infrastructure"],
  ),
  defineIcon(
    "alibaba-cloud",
    "Alibaba Cloud",
    "cloud",
    createRoleIcon("AlibabaCloud", "cloud", alibabacloud),
    ["alibaba", "alibabacloud", "aliyun", "ecs"],
  ),
  defineIcon("tencent-cloud", "Tencent Cloud", "cloud", tencentcloud, [
    "tencent",
    "tencentcloud",
    "qcloud",
    "cloud",
  ]),
  defineIcon(
    "ibm-cloud",
    "IBM Cloud",
    "cloud",
    createRoleIcon("IBMCloud", "cloud", ibm),
    ["ibm", "ibmcloud", "bluemix", "softlayer"],
  ),
  defineIcon(
    "redhat-cloud",
    "Red Hat cloud",
    "cloud",
    createRoleIcon("RedHatCloud", "cloud", redhat),
    ["redhat", "red hat", "openshift", "cloud"],
  ),
  defineIcon(
    "linode",
    "Linode",
    "cloud",
    linode,
    ["linode", "akamai", "cloud", "vps"],
    "Linode connection icon using the historical Linode cube mark, not the current Akamai logo.",
  ),
] as const;

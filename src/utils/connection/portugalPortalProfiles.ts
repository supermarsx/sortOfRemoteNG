import type { HttpApplicationProfile } from "./httpApplicationProfiles";

const manualSignIn =
  "Início de sessão apenas manual. As credenciais guardadas e os códigos 2FA não são preenchidos automaticamente; autenticação federada, Chave Móvel Digital, Cartão de Cidadão e outros desafios, quando pedidos, ficam a cargo do utilizador.";

const portal = (
  id: string,
  label: string,
  hostedLoginUrl: string,
  description: string,
): HttpApplicationProfile => ({
  id,
  label,
  category: "business",
  capability: "manual",
  requiresHttps: true,
  loginModes: ["manual"],
  hostedLoginUrl,
  description: `${description} ${manualSignIn}`,
});

/**
 * Public Portuguese portal entry points reviewed on 2026-10-06.
 * Evidence, redirects and limitations: docs/portugal-portal-profiles.md.
 * These data-only profiles do not authorize credential release or network routes.
 * Registry integration belongs to the shared catalog owner.
 */
export const PORTUGAL_PORTAL_PROFILES: readonly HttpApplicationProfile[] = [
  // Official customer guide, pp. 10 and 14, links to myPRIMAVERA:
  // https://www.primaverabss.com/pt/Userfiles/Downloads/Processo_de_Registo_Adesao_Faturacao_Direta_Cliente.pdf
  // https://myprimavera.primaverabss.com/pt/ now redirects to this myCegid entry.
  portal(
    "cegid-primavera",
    "Cegid Primavera — Portal de Cliente",
    "https://mycegid.ila.cegid.com/pt/",
    "Portal de cliente myCegid, anteriormente myPRIMAVERA, para subscrições Cegid Primavera. O acesso passa pelo Cegid ID; não é o Partner Space nem o endereço de uma instalação ERP da empresa.",
  ),
  // https://www.portaldasfinancas.gov.pt/at/html/index.html
  // Its published /geral/dashboard sign-in target returned 404 during review;
  // keep the working official portal entry, not a guessed identity-provider URL.
  portal(
    "autoridade-tributaria",
    "Autoridade Tributária — Portal das Finanças",
    "https://www.portaldasfinancas.gov.pt/at/html/index.html",
    "Entrada oficial do Portal das Finanças. Escolha Iniciar Sessão ou o serviço pretendido no portal; a disponibilidade do destino de autenticação depende da AT.",
  ),
  // https://www.seg-social.pt/ redirects to /ptss/ (Segurança Social Direta),
  // which currently redirects to /ptss/pssd/home. Do not pin a CAS transaction.
  portal(
    "seguranca-social-direta",
    "Segurança Social Direta",
    "https://www.seg-social.pt/ptss/",
    "Portal da Segurança Social Direta. Selecione o serviço e o método de autenticação disponibilizados pelo portal; a conta da Segurança Social é distinta da conta das Finanças.",
  ),
  // https://registo.justica.gov.pt/ publishes /Login; the unauthenticated entry
  // redirects to autenticacao.irn.justica.gov.pt using a SAML transaction.
  portal(
    "irn-online",
    "IRN — Registos online",
    "https://registo.justica.gov.pt/Login",
    "Acesso à Plataforma de Registos do IRN. Os serviços e a representação são escolhidos no portal; os portais especializados podem ter acessos próprios.",
  ),
  // https://www.e-redes.pt/pt-pt/ajuda/perguntas-frequentes/anomalias-avarias-videos
  // links directly to this Balcão Digital entry, not the institutional homepage.
  portal(
    "e-redes",
    "E-REDES — Balcão Digital",
    "https://balcaodigital.e-redes.pt/home",
    "Balcão Digital da E-REDES para locais de consumo, leituras, ligações à rede e pedidos. Escolha Login no portal para aceder à área reservada.",
  ),
  // https://www.meo.pt/cliente -> my MEO na Web.
  portal(
    "meo-particulares",
    "MEO — Particulares (my MEO)",
    "https://my.meo.pt/",
    "Área de cliente my MEO para particulares. O portal também permite associar alguns serviços empresariais; a Área de Cliente Empresarial tem uma entrada própria.",
  ),
  // https://www.meo.pt/empresas/cliente -> Entrar (Grandes Empresas).
  // Retain the published entry, never a captured OpenID state/code_challenge.
  portal(
    "meo-empresas",
    "MEO — Empresas",
    "https://cliente-empresas.meo.pt/Pages/Dashboard/Dashboard.aspx",
    "Área de Cliente Empresarial MEO, publicada para Grandes Empresas. O acesso utiliza ID MEO; outras empresas e empresários em nome individual podem usar my MEO conforme o serviço.",
  ),
  // https://my.vodafone.pt/ is the My Vodafone account portal and redirects
  // to /main.html; do not persist login.vodafone.pt transaction parameters.
  portal(
    "vodafone-portugal",
    "My Vodafone — Portugal",
    "https://my.vodafone.pt/",
    "Área de cliente My Vodafone Portugal para contas, produtos e serviços. Selecione o acesso disponibilizado pelo portal e conclua as verificações pedidas.",
  ),
  // https://www.digi.pt/apoio-ao-cliente -> My DIGI.
  portal(
    "digi-portugal",
    "DIGI — Portugal (My DIGI)",
    "https://mydigi.digi.pt/",
    "Área de cliente My DIGI Portugal. Esta entrada é distinta do acompanhamento de pedidos, do pagamento público de faturas e dos portais DIGI de outros países.",
  ),
  // https://www.imt-ip.pt/faq/como-posso-aceder-aos-servicos-do-imtonline-2/
  // The linked portal redirects to /login.aspx; its query-free entry was read.
  portal(
    "imt-online",
    "IMT — Serviços online",
    "https://servicos.imt-ip.pt/login.aspx",
    "IMT Online para particulares, empresas e representantes. Escolha a opção de acesso adequada; a página oferece percursos de autenticação distintos.",
  ),
  // https://www.viaverde.pt/particulares/login (A Minha Via Verde).
  portal(
    "via-verde",
    "Via Verde — Área de cliente",
    "https://www.viaverde.pt/particulares/login",
    "Área reservada Via Verde para particulares. As áreas de empresas, parceiros e visitantes têm percursos próprios; este perfil não as substitui.",
  ),
  // https://www.uzo.pt/ajuda -> Área de cliente my UZO na web -> my.uzo.pt.
  portal(
    "uzo-particulares",
    "UZO — Particulares (my UZO)",
    "https://my.uzo.pt/",
    "Entrada my UZO para contas particulares. Se a UZO disponibilizar uma conta empresarial no mesmo acesso, utilize esta entrada para os serviços associados. Não foi confirmado um portal UZO Empresas separado.",
  ),
  // No UZO Empresas preset: official support mentions business customers but
  // provides no reviewed separate business portal. See the evidence document.
];

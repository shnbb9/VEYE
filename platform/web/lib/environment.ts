/** Development wording belongs to development. A deployed console must never
 *  tell an administrator that real members are synthetic, so anything that
 *  does is shown only where the build says it is local (compose.local.yaml);
 *  a build that says nothing shows none of it. */
export const isLocalBuild = process.env.NEXT_PUBLIC_ENVIRONMENT === "local";

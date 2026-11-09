import { signAccessToken } from "../../src/auth/tokens";
import { Role } from "../../src/config/constants";

export interface FixtureUser {
  id: string;
  email: string;
  orgId: string;
  role: Role;
  token: string;
}

export interface FixtureOrg {
  id: string;
  name: string;
  owner: FixtureUser;
  admin: FixtureUser;
  member: FixtureUser;
}

export interface TwoOrgFixture {
  orgA: FixtureOrg;
  orgB: FixtureOrg;
}

export function createTwoOrgFixture(): TwoOrgFixture {
  const orgAId = "11111111-1111-4111-8111-111111111111";
  const orgBId = "22222222-2222-4222-8222-222222222222";

  const makeUser = (id: string, email: string, orgId: string, role: Role): FixtureUser => {
    return {
      id,
      email,
      orgId,
      role,
      token: signAccessToken({ userId: id, orgId, role }),
    };
  };

  const orgA: FixtureOrg = {
    id: orgAId,
    name: "Organization Alpha",
    owner: makeUser("usr-alpha-owner", "owner@alpha.test", orgAId, "owner"),
    admin: makeUser("usr-alpha-admin", "admin@alpha.test", orgAId, "admin"),
    member: makeUser("usr-alpha-member", "member@alpha.test", orgAId, "member"),
  };

  const orgB: FixtureOrg = {
    id: orgBId,
    name: "Organization Beta",
    owner: makeUser("usr-beta-owner", "owner@beta.test", orgBId, "owner"),
    admin: makeUser("usr-beta-admin", "admin@beta.test", orgBId, "admin"),
    member: makeUser("usr-beta-member", "member@beta.test", orgBId, "member"),
  };

  return { orgA, orgB };
}

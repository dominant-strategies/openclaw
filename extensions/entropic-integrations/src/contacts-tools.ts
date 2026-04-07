import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { runGws } from "./gws.js";
import {
  asRecord,
  asRecordArray,
  jsonResult,
  readNumber,
  readString,
  readStringField,
  readStringList,
} from "./tool-utils.js";

function extractContact(person: unknown) {
  const personRecord = asRecord(person);
  const names = asRecordArray(personRecord?.names);
  const orgs = asRecordArray(personRecord?.organizations);
  return {
    resourceName: readStringField(personRecord, "resourceName") ?? null,
    name: readStringField(names[0], "displayName") ?? null,
    emails: readStringList(personRecord?.emailAddresses),
    phones: readStringList(personRecord?.phoneNumbers),
    organization: readStringField(orgs[0], "name") ?? null,
    title: readStringField(orgs[0], "title") ?? null,
  };
}

export function createContactsListTool(_api: OpenClawPluginApi) {
  return {
    name: "contacts_list",
    label: "Contacts List",
    description: "List contacts from Google Contacts.",
    parameters: Type.Object({
      pageSize: Type.Optional(
        Type.Number({ description: "Max contacts to return (default 20, max 100)." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const pageSize = Math.min(readNumber(params, "pageSize", 20) ?? 20, 100);

      const data = asRecord(
        await runGws(["people", "people", "connections", "list"], {
          params: {
            resourceName: "people/me",
            pageSize,
            personFields: "names,emailAddresses,phoneNumbers,organizations",
            sortOrder: "LAST_NAME_ASCENDING",
          },
        }),
      );

      return jsonResult({
        contacts: asRecordArray(data?.connections).map(extractContact),
        totalPeople: data?.totalPeople,
      });
    },
  };
}

export function createContactsSearchTool(_api: OpenClawPluginApi) {
  return {
    name: "contacts_search",
    label: "Contacts Search",
    description: "Search Google Contacts by name, email, or phone number.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (name, email, or phone)." }),
      pageSize: Type.Optional(Type.Number({ description: "Max results (default 10, max 30)." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const query = readString(params, "query");
      if (!query) {
        throw new Error("query is required");
      }
      const pageSize = Math.min(readNumber(params, "pageSize", 10) ?? 10, 30);

      const data = asRecord(
        await runGws(["people", "people", "searchContacts"], {
          params: {
            query,
            pageSize,
            readMask: "names,emailAddresses,phoneNumbers,organizations",
          },
        }),
      );

      return jsonResult({
        contacts: asRecordArray(data?.results).map((result) => extractContact(result.person)),
      });
    },
  };
}

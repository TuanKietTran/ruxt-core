import { describe, expect, it } from "vitest";
import { createHandler } from "../cqrs";
import { testMediator } from "./helpers/fakes";

describe("CQRS mediator", () => {
   const mediator = testMediator();

   it("routes commands and queries by request name", async () => {
      mediator.registerCommand(createHandler<{ value: number }, number>("DoubleIt", async ({ value }) => ({ success: true, data: value * 2 })));
      mediator.registerQuery(createHandler<void, string>("ReadIt", async () => ({ success: true, data: "ok" })));

      await expect(mediator.send({ _type: "command", requestName: "DoubleIt", payload: { value: 21 } })).resolves.toBe(42);
      await expect(mediator.send({ _type: "query", requestName: "ReadIt", payload: undefined })).resolves.toBe("ok");
   });

   it("rejects unregistered request names", async () => {
      await expect(mediator.send({ _type: "query", requestName: "NoSuchThing", payload: {} }))
         .rejects.toThrow("No handler registered for type: NoSuchThing");
   });

   it("converts thrown handler errors into failed results", async () => {
      const handler = createHandler<void, void>("Explodes", async () => { throw new Error("boom"); });
      await expect(handler.execute(undefined)).resolves.toEqual({ success: false, error: "boom" });
   });

   it("unwraps failed results as rejections at the send boundary", async () => {
      mediator.registerCommand(createHandler<void, void>("AlwaysFails", async () => ({ success: false, error: "CV template not found" })));
      await expect(mediator.send({ _type: "command", requestName: "AlwaysFails", payload: undefined }))
         .rejects.toThrow("CV template not found");
   });

   it("names the handler when a thrown value carries no message", async () => {
      const handler = createHandler<void, void>("Nameless", async () => { throw new Error(""); });
      await expect(handler.execute(undefined)).resolves.toEqual({ success: false, error: 'Handler "Nameless" failed' });
   });
});

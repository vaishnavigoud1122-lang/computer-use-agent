import { Page, Locator } from "playwright";
import { Artifact } from "../artifact/schema";
import fs from "fs";
import path from "path";

export type ReplayResult =
  | {
      status: "success";
      outputs: Record<string, unknown>;
    }
  | {
      status: "business_outcome";
      outcome: string;
      outputs: Record<string, unknown>;
    }
  | {
      status: "recoverable";
      stepId: string;
      message: string;
    }
  | {
      status: "hard_failure";
      stepId: string;
      message: string;
    };

export class ReplayEngine {
  constructor(private readonly page: Page) {}

  async replay(
    artifact: Artifact,
    parameters: Record<string, unknown>,
  ): Promise<ReplayResult> {
    const outputs: Record<string, unknown> = {};

    let currentStepId = "unknown";

    try {
      this.validateParameters(
        artifact,
        parameters,
      );

      for (const step of artifact.steps) {
        currentStepId = step.id;

        console.log(
          `[REPLAY] ${step.id}: ${step.description}`,
        );

        switch (step.action) {
          case "navigate":
            await this.navigate(
              step.value,
              parameters,
            );
            break;

          case "click":
            await this.click(step.target);
            break;

          case "type":
            await this.type(
              step.target,
              step.value,
              parameters,
            );
            break;

          case "select":
            await this.select(
              step.target,
              step.value,
              parameters,
            );
            break;

          case "extract":
            await this.extract(
              step.target,
              step.output,
              outputs,
            );
            break;

          case "wait":
            await this.wait(step.value);
            break;

          default:
            throw new Error(
              `Unsupported action: ${step.action}`,
            );
        }

        if (step.checkpoint) {
          await this.verifyCheckpoint(
            step.checkpoint,
          );
        }
      }

      await this.verifySuccessCondition(
        artifact.successCondition,
        outputs,
      );

      console.log(
        "[REPLAY] Replay completed successfully.",
      );

      return {
        status: "success",
        outputs,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `[REPLAY ERROR] Step: ${currentStepId}`,
      );

      console.error(
        `[REPLAY ERROR] ${message}`,
      );

      /*
       * Save richer evidence for unexpected replay
       * failures. This includes:
       * - screenshot
       * - current URL
       * - visible page text
       * - failed step
       * - error message
       */
      await this.captureFailureEvidence(
        currentStepId,
        message,
      );

      /*
       * A missing member is a valid business outcome,
       * not a technical replay failure.
       */
      if (
        message.includes("No member found")
      ) {
        return {
          status: "business_outcome",
          outcome: "member_not_found",
          outputs,
        };
      }

      return {
        status: "hard_failure",
        stepId: currentStepId,
        message,
      };
    }
  }

  private async captureFailureEvidence(
    stepId: string,
    message: string,
  ): Promise<void> {
    try {
      const evidenceDir = path.join(
        process.cwd(),
        "evidence",
        "replay-failures",
      );

      fs.mkdirSync(
        evidenceDir,
        { recursive: true },
      );

      const timestamp =
        new Date()
          .toISOString()
          .replace(/[:.]/g, "-");

      const baseName =
        `failure-${timestamp}-${stepId}`;

      /*
       * Screenshot
       */
      await this.page.screenshot({
        path: path.join(
          evidenceDir,
          `${baseName}.png`,
        ),
        fullPage: true,
      });

      /*
       * DOM / visible text evidence
       */
      const pageText =
        await this.page
          .locator("body")
          .innerText()
          .catch(() => "");

      fs.writeFileSync(
        path.join(
          evidenceDir,
          `${baseName}.txt`,
        ),
        pageText,
        "utf8",
      );

      /*
       * Structured failure metadata.
       */
      const metadata = {
        timestamp:
          new Date().toISOString(),
        stepId,
        message,
        url: this.page.url(),
      };

      fs.writeFileSync(
        path.join(
          evidenceDir,
          `${baseName}.json`,
        ),
        JSON.stringify(
          metadata,
          null,
          2,
        ),
        "utf8",
      );

      console.log(
        `[EVIDENCE] Failure screenshot saved: evidence/replay-failures/${baseName}.png`,
      );

      console.log(
        `[EVIDENCE] Failure page text saved: evidence/replay-failures/${baseName}.txt`,
      );

      console.log(
        `[EVIDENCE] Failure metadata saved: evidence/replay-failures/${baseName}.json`,
      );
    } catch (evidenceError) {
      /*
       * Evidence capture must never hide the original
       * replay error.
       */
      console.error(
        "[EVIDENCE ERROR] Could not capture failure evidence.",
      );

      console.error(evidenceError);
    }
  }

  private validateParameters(
    artifact: Artifact,
    parameters: Record<string, unknown>,
  ): void {
    for (const parameter of artifact.parameters) {
      const value =
        parameters[parameter.name];

      if (
        parameter.required &&
        (value === undefined ||
          value === null ||
          value === "")
      ) {
        throw new Error(
          `Missing required parameter: ${parameter.name}`,
        );
      }

      if (
        parameter.type === "number" &&
        typeof value !== "number"
      ) {
        throw new Error(
          `Parameter "${parameter.name}" must be a number.`,
        );
      }

      if (
        parameter.type === "boolean" &&
        typeof value !== "boolean"
      ) {
        throw new Error(
          `Parameter "${parameter.name}" must be a boolean.`,
        );
      }

      if (
        parameter.type === "string" &&
        typeof value !== "string"
      ) {
        throw new Error(
          `Parameter "${parameter.name}" must be a string.`,
        );
      }
    }
  }

  private async navigate(
    value: string | undefined,
    parameters: Record<string, unknown>,
  ): Promise<void> {
    if (!value) {
      throw new Error(
        "Navigate step is missing a URL.",
      );
    }

    const url = this.replaceParameters(
      value,
      parameters,
    );

    console.log(`[NAVIGATE] ${url}`);

    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
    });
  }

  private async click(
    target?: Artifact["steps"][number]["target"],
  ): Promise<void> {
    const locator =
      await this.findTarget(target);

    await locator.dispatchEvent("click");

    await this.page.waitForLoadState(
      "domcontentloaded",
    );
  }

  private async type(
    target: Artifact["steps"][number]["target"],
    value: string | undefined,
    parameters: Record<string, unknown>,
  ): Promise<void> {
    if (!value) {
      throw new Error(
        "Type step is missing a value.",
      );
    }

    const locator =
      await this.findTarget(target);

    const resolvedValue =
      this.replaceParameters(
        value,
        parameters,
      );

    await locator.fill(
      resolvedValue,
    );

    console.log(
      "[TYPE] Entered value for parameterized field.",
    );
  }

  private async select(
    target: Artifact["steps"][number]["target"],
    value: string | undefined,
    parameters: Record<string, unknown>,
  ): Promise<void> {
    if (!value) {
      throw new Error(
        "Select step is missing a value.",
      );
    }

    const locator =
      await this.findTarget(target);

    const resolvedValue =
      this.replaceParameters(
        value,
        parameters,
      );

    await locator.selectOption(
      resolvedValue,
    );
  }

  private async extract(
    target: Artifact["steps"][number]["target"],
    outputName: string | undefined,
    outputs: Record<string, unknown>,
  ): Promise<void> {
    if (!outputName) {
      throw new Error(
        "Extract step is missing an output name.",
      );
    }

    const locator =
      await this.findTarget(target);

    const text =
      await locator.textContent();

    const extractedValue =
      text?.trim() ?? "";

    outputs[outputName] =
      this.normalizeExtractedValue(
        outputName,
        extractedValue,
      );

    console.log(
      `[EXTRACT] ${outputName}: ${outputs[outputName]}`,
    );
  }

  private normalizeExtractedValue(
    outputName: string,
    value: string,
  ): unknown {
    if (
      outputName === "savingsBalance"
    ) {
      const cleaned = value
        .replace(/[$,]/g, "")
        .trim();

      const numberValue =
        Number(cleaned);

      if (!Number.isNaN(numberValue)) {
        return numberValue;
      }
    }

    return value;
  }

  private async wait(
    value?: string,
  ): Promise<void> {
    const milliseconds = Number(
      value ?? "1000",
    );

    if (
      Number.isNaN(milliseconds) ||
      milliseconds < 0
    ) {
      throw new Error(
        `Invalid wait duration: ${value}`,
      );
    }

    await this.page.waitForTimeout(
      milliseconds,
    );
  }

  private async findTarget(
    target?: Artifact["steps"][number]["target"],
    attachTimeoutMs = 2000,
  ) {
    if (!target) {
      throw new Error("Step is missing a target.");
    }

    const strategies = [target, ...(target.fallback ?? [])];

    let lastError;

    for (const strategy of strategies) {
      try {
        console.log(`[LOCATOR] Trying ${strategy.type}: ${strategy.value}`);

        let locator;

        switch (strategy.type) {
          case "role": {
            const parts = strategy.value.split(":");
            const role = parts[0];
            const name = parts.slice(1).join(":");

            locator =
              role === "button" && name
                ? this.page.getByRole("button", { name })
                : this.page.getByRole(role as any);

            break;
          }

          case "text":
            locator = this.page.getByText(strategy.value);
            break;

          case "label":
            locator = this.page.getByLabel(strategy.value);
            break;

          case "css":
            locator = this.page.locator(strategy.value);
            break;

          case "xpath":
            locator = this.page.locator(`xpath=${strategy.value}`);
            break;

          case "iframe":
            throw new Error("Iframe targets are not supported by this replay version.");

          default:
            throw new Error(`Unsupported locator type: ${strategy.type}`);
        }

        await locator.waitFor({
          state: "attached",
          timeout: attachTimeoutMs,
        });

        return locator;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`Could not find target. Last error: ${String(lastError)}`);
  }


  private async verifyCheckpoint(
    checkpoint: string,
  ): Promise<void> {
    console.log(
      `[CHECKPOINT] ${checkpoint}`,
    );

    if (
      checkpoint.includes(
        "Member Search",
      )
    ) {
      await this.page
        .getByText("Member Search", {
          exact: true,
        })
        .waitFor({
          state: "visible",
          timeout: 5000,
        });

      console.log(
        "[CHECKPOINT PASSED] Member Search page is visible.",
      );

      return;
    }

    if (
      checkpoint.includes(
        "Member search result",
      )
    ) {
      await this.page.waitForLoadState(
        "domcontentloaded",
      );

      await this.page.waitForTimeout(
        300,
      );

      const bodyText =
        await this.page
          .locator("body")
          .innerText();

      console.log(
        `[CHECKPOINT] Page text:\n${bodyText}`,
      );

      if (
        bodyText.includes(
          "No member found",
        )
      ) {
        console.log(
          "[CHECKPOINT] Business outcome detected: member not found.",
        );

        throw new Error(
          "No member found",
        );
      }

      if (
        /\/members\/\d+/.test(
          this.page.url(),
        )
      ) {
        console.log(
          "[CHECKPOINT PASSED] Member details page is open.",
        );

        return;
      }

      throw new Error(
        `Member search completed but no recognized result was found. Current URL: ${this.page.url()}`,
      );
    }

    if (
      checkpoint.includes(
        "Savings balance",
      ) ||
      checkpoint.includes(
        "Current balance",
      )
    ) {
      await this.page
        .getByText(
          "Current Balance",
          {
            exact: true,
          },
        )
        .waitFor({
          state: "visible",
          timeout: 5000,
        });

      console.log(
        "[CHECKPOINT PASSED] Current balance is visible.",
      );

      return;
    }

    console.log(
      `[CHECKPOINT] No specific verification rule for: ${checkpoint}`,
    );
  }

  private async verifySuccessCondition(
    condition: string,
    outputs: Record<string, unknown>,
  ): Promise<void> {
    console.log(
      `[SUCCESS CHECK] ${condition}`,
    );

    if (
      condition.includes(
        "current balance",
      ) ||
      condition.includes(
        "savings balance",
      )
    ) {
      await this.page
        .getByText(
          "Current Balance",
          {
            exact: true,
          },
        )
        .waitFor({
          state: "visible",
          timeout: 5000,
        });

      if (
        outputs.savingsBalance ===
          undefined ||
        outputs.savingsBalance === ""
      ) {
        throw new Error(
          "Success condition failed: savings balance was not extracted.",
        );
      }

      console.log(
        "[SUCCESS CHECK PASSED] Current balance was extracted.",
      );

      return;
    }

    await this.page.waitForLoadState(
      "domcontentloaded",
    );
  }

  private replaceParameters(
    value: string,
    parameters: Record<string, unknown>,
  ): string {
    return value.replace(
      /\{\{(\w+)\}\}/g,
      (_match, name: string) => {
        const parameter =
          parameters[name];

        if (
          parameter === undefined
        ) {
          return `{{${name}}}`;
        }

        return String(parameter);
      },
    );
  }
}
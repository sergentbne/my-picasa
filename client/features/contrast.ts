import { ImageController } from "../components/image-controller";
import { ToolRegistrar } from "../components/tools";
import { toolHeader } from "../element-templates";
import { transform } from "../imageProcess/client";
import { $ } from "../lib/dom";
import { isPicture } from "../../shared/lib/utils";

export function setupContrast(
  imageController: ImageController,
  toolRegistrar: ToolRegistrar
) {
  const name = "Contrast";
  toolRegistrar.registerTool(name, {
    filterName: "contrast",
    enable: (e) => isPicture(e),
    build: function (amount: number) {
      return `${this.filterName}=1,${amount}`;
    },
    icon: async function (context) {
      await transform(context, this.build(150));
      return true;
    },
    activate: async function () {
      imageController.addOperation(this.build(100));
      return true;
    },
    buildUI: function (index: number, args: string[]) {
      const e = toolHeader(name, index, imageController);
      e.append(`<div>
      <div class="tool-control slidecontainer">
          <label>Constrast level</label>
          <input type="range" min="0" max="200" value="100" class="amount slider">
        </div>
      <div>
    </div></div>`);
      const update = () => {
        const amount = $(".amount", e).val();
        imageController.updateOperation(index, this.build(amount));
      };
      $(".amount", e).val(parseInt(args[1] || "0"));

      $(".amount", e).on("change", update);
      return e.get()!;
    },
  });
}
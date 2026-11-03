import { Select as SelectPrimitive } from "bits-ui";

import GroupHeading from "./select-group-heading.svelte";
import Item from "./select-item.svelte";
import Content from "./select-content.svelte";
import Trigger from "./select-trigger.svelte";
import Value from "./select-value.svelte";
import Separator from "./select-separator.svelte";
import ScrollDownButton from "./select-scroll-down-button.svelte";
import ScrollUpButton from "./select-scroll-up-button.svelte";
import SelectField from "./select-field.svelte";
export type { SelectFieldOption } from "./select-field-types";

const Root = SelectPrimitive.Root;
const Group = SelectPrimitive.Group;

export {
	Root,
	Group,
	Value,
	GroupHeading,
	Item,
	Content,
	Trigger,
	Separator,
	ScrollDownButton,
	ScrollUpButton,
	SelectField,
	//
	Root as Select,
	Group as SelectGroup,
	Value as SelectValue,
	GroupHeading as SelectGroupHeading,
	Item as SelectItem,
	Content as SelectContent,
	Trigger as SelectTrigger,
	Separator as SelectSeparator,
	ScrollDownButton as SelectScrollDownButton,
	ScrollUpButton as SelectScrollUpButton,
};

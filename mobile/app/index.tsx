import { Redirect } from "expo-router";

/** `/` has no screen of its own; open the Today tab. */
export default function Index() {
  return <Redirect href="/today" />;
}

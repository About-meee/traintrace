import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import LoginGate from "./login-gate";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <LoginGate
      authenticated={Boolean(user)}
      signInHref={chatGPTSignInPath("/")}
      signOutHref={chatGPTSignOutPath("/")}
    />
  );
}

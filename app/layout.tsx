import type {Metadata} from "next"; import "./globals.css";
export const metadata:Metadata={title:"Blackwood Colony",description:"Interactive ant foraging simulation"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}

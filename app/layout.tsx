import type { Metadata } from 'next';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './globals.css';
export const metadata:Metadata={title:'Timecard — A little more present',description:'Simple face and location attendance, thoughtful leave management, and a clearer workday.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}

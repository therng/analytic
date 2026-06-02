import { useState, useEffect } from 'react';

export function useRealtimeAccount(accountId: string) {
    const [realtimeData, setRealtimeData] = useState<any>(null);

    useEffect(() => {
        if (!accountId) return;
        
        // Use environment variable for WS URL, fallback to localhost:8000 for local dev
        const wsBase = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
        const wsUrl = wsBase.endsWith("/ws") ? `${wsBase}/account/${accountId}` : `${wsBase}/ws/account/${accountId}`;
        
        const ws = new WebSocket(wsUrl);
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                setRealtimeData(data);
            } catch (e) {
                console.error("Error parsing WS message", e);
            }
        };

        ws.onclose = () => {
            console.log("WS closed for", accountId);
        };

        return () => {
            ws.close();
        };
    }, [accountId]);

    return realtimeData;
}

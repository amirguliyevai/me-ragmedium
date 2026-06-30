package com.ragmedium.agentcmd;

import com.getcapacitor.BridgeActivity;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;

public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        // Auto-grant microphone permission in WebView on Android 13+
        // This handles the case where system permission is already granted
        // but WebView's getUserMedia() still blocks
        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                String[] resources = request.getResources();
                for (String res : resources) {
                    if (res.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        request.grant(request.getResources());
                        return;
                    }
                }
                request.deny();
            }
        });
    }
}

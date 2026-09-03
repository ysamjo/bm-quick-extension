package de.stegmann.brickmerge;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

public final class ShareActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent source = getIntent();
        CharSequence shared = Intent.ACTION_PROCESS_TEXT.equals(source.getAction())
                ? source.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
                : source.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String input = shared == null ? "" : shared.toString().trim();
        if (input.isEmpty()) {
            Toast.makeText(this, R.string.invalid_share, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        Intent target = new Intent(this, MainActivity.class)
                .putExtra(MainActivity.EXTRA_INPUT, input)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(target);
        finish();
    }
}

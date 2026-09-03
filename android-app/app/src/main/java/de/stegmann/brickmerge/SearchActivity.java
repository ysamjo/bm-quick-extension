package de.stegmann.brickmerge;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class SearchActivity extends Activity {
    static final String EXTRA_PREFILL = "de.stegmann.brickmerge.PREFILL";
    private EditText input;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(22), dp(24), dp(18));

        TextView title = new TextView(this);
        title.setText(R.string.search_title);
        title.setTextColor(Color.rgb(30, 30, 30));
        title.setTextSize(21);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        input = new EditText(this);
        input.setHint(R.string.search_hint);
        input.setSingleLine(true);
        input.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        String prefill = getIntent().getStringExtra(EXTRA_PREFILL);
        if (prefill != null) {
            input.setText(prefill);
            input.setSelection(input.length());
        }
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(52)
        );
        inputParams.setMargins(0, dp(16), 0, dp(14));
        root.addView(input, inputParams);

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.END);

        Button cancel = new Button(this);
        cancel.setText(R.string.search_cancel);
        cancel.setAllCaps(false);
        actions.addView(cancel, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                dp(46)
        ));

        Button search = new Button(this);
        search.setText(R.string.search_action);
        search.setTextColor(Color.WHITE);
        search.setAllCaps(false);
        search.setBackgroundResource(R.drawable.search_button_background);
        LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(dp(100), dp(46));
        searchParams.setMargins(dp(8), 0, 0, 0);
        actions.addView(search, searchParams);
        root.addView(actions);

        setContentView(root);
        getWindow().setLayout(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT
        );
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);

        cancel.setOnClickListener(view -> finish());
        search.setOnClickListener(view -> submit());
        input.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId != EditorInfo.IME_ACTION_SEARCH) return false;
            submit();
            return true;
        });
        input.requestFocus();
    }

    private void submit() {
        String value = input.getText().toString().replaceAll("\\s+", " ").trim();
        if (value.isEmpty()) {
            input.setError(getString(R.string.search_required));
            return;
        }
        Intent intent = new Intent(this, MainActivity.class)
                .putExtra(MainActivity.EXTRA_INPUT, value)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

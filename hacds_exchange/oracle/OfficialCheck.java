import java.io.*;
import java.util.*;

/**
 * 官方评分逻辑独立验证器。【历史存档，2026-10-19 起不再作为基准】
 * 项目方已决定评分标准切换为 Diamond_Analyzer v0.1.1（当初交易所使用的版本），
 * 本文件保留仅供追溯第一/二轮交叉验证（见 评分交叉验证报告.md）。
 *
 * 算法条件逐行拷贝自 hacds_server-main/src/main/java/diamond/util/AnalyseDiamond.java，
 * 仅剥离 Spring/lombok/fastjson 依赖：rule.txt 用简易 JSON 解析（只取 metric_en/score/typeEn），
 * Diamond 用公开字段替代 lombok @Data。
 * 语义对齐点：
 *  - map: metric_en 完整键（含尾随空格）→ rule；cleanMap: split("\\|")[0] → rule
 *  - setDiamondScore 用 cleanMap 查分（shapes/color 为短名，styles/nameliteral/numberliteral 为完整键）
 *  - getMaxScoreFeature 用 map 查分、降序稳定排序取第一
 *  - number symmetry 与 serialRepeat 在官方中已注释，不参与
 */
public class OfficialCheck {

    static Map<String, int[]> map = new HashMap<>();       // metric_en -> [score]
    static Map<String, int[]> cleanMap = new HashMap<>();
    static String shapes = "", color = "", styles = "", nameliteral = "", numberliteral = "";

    public static void main(String[] args) throws Exception {
        loadRules("rule.txt");
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = br.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            String[] p = line.split("\t");
            String name = p[0], number = p[1], visualGene = p[2];
            D d = new D();
            d.name = name; d.number = number; d.visualGene = visualGene;
            d.numberliteral = getNumberliterals(d);
            d.nameliteral = getNameliteral(d);
            d.shapes = getDiamondshapes(d);
            if (d.shapes.equals("Common diamond")) {
                d.styles = getDiamondStyles(d);
            } else {
                d.color = getDiamondColor(d);
            }
            setDiamondScore(d);
            System.out.println(d.name + "\t" + d.shapes + "\t" + d.styles + "\t" + d.color
                    + "\t" + d.nameliteral + "\t" + d.numberliteral + "\t" + d.score);
        }
    }

    static void loadRules(String path) throws IOException {
        BufferedReader bufr = new BufferedReader(new FileReader(path));
        String text = bufr.readLine();
        // 简易解析：逐段扫 "{...}" 对象体，metric_en 从对象体内取（外层键可能与 metric_en 不同）
        int i = 0;
        while (true) {
            int k0 = text.indexOf('{', i);
            if (k0 < 0) break;
            int k1 = text.indexOf('}', k0);
            if (k1 < 0) break;
            String body = text.substring(k0 + 1, k1);
            i = k1 + 1;
            if (!body.contains("\"metric_en\"")) continue;
            int score = intField(body, "\"score\":");
            String metricEn = strField(body, "\"metric_en\":\"");
            String typeEn = strField(body, "\"typeEn\":\"");
            int[] rule = new int[]{score};
            cleanMap.put(metricEn.split("\\|")[0], rule);
            map.put(metricEn, rule);
            if (typeEn.equals("shapes")) shapes = shapes + metricEn + ",";
            if (typeEn.equals("color")) color = color + metricEn + ",";
            if (typeEn.equals("styles")) styles = styles + metricEn + ",";
            if (typeEn.equals("nameliteral")) nameliteral = nameliteral + metricEn + ",";
            if (typeEn.equals("numberliteral")) numberliteral = numberliteral + metricEn + ",";
        }
        shapes = shapes.substring(0, shapes.length() - 1);
        color = color.substring(0, color.length() - 1);
        styles = styles.substring(0, styles.length() - 1);
        nameliteral = nameliteral.substring(0, nameliteral.length() - 1);
        numberliteral = numberliteral.substring(0, numberliteral.length() - 1);
    }

    static int intField(String body, String key) {
        int i = body.indexOf(key);
        if (i < 0) return 0;
        int j = i + key.length();
        int v = 0;
        while (j < body.length() && Character.isDigit(body.charAt(j))) {
            v = v * 10 + (body.charAt(j) - '0');
            j++;
        }
        return v;
    }

    static String strField(String body, String key) {
        int i = body.indexOf(key);
        if (i < 0) return "";
        int j = i + key.length();
        int k = body.indexOf('"', j);
        return body.substring(j, k);
    }

    public static void setDiamondScore(D d) {
        int shapeScore = cleanMap.get(d.shapes) == null ? 0 : cleanMap.get(d.shapes)[0];
        int stylesScore = cleanMap.get(d.styles) == null ? 0 : cleanMap.get(d.styles)[0];
        int nameLiteral = cleanMap.get(d.nameliteral) == null ? 0 : cleanMap.get(d.nameliteral)[0];
        int numberLiteral = cleanMap.get(d.numberliteral) == null ? 0 : cleanMap.get(d.numberliteral)[0];
        int colorScore = cleanMap.get(d.color) == null ? 0 : cleanMap.get(d.color)[0];
        d.score = shapeScore + stylesScore + nameLiteral + numberLiteral + colorScore;
    }

    public static String getDiamondStyles(D d) {
        StringBuffer sb = new StringBuffer();
        String style = d.visualGene.substring(2, 18);
        String thirteen = style.charAt(12) + "";
        String fourteen = style.charAt(13) + "";
        String fiveteen = style.charAt(14) + "";
        String sixteen = style.charAt(15) + "";

        if (thirteen.equals(fourteen) && fourteen.equals(fiveteen) && fiveteen.equals(sixteen)) {
            sb.append("Pure,");
        }
        if ((fourteen.equals(fiveteen) && fiveteen.equals(thirteen)) && !fourteen.equals(sixteen)) {
            sb.append("Left three pure,");
        }
        if ((thirteen.equals(fiveteen) && fiveteen.equals(sixteen)) && !fourteen.equals(thirteen)) {
            sb.append("Left mix pure,");
        }
        if ((thirteen.equals(fourteen) && fourteen.equals(sixteen)) && !fiveteen.equals(thirteen)) {
            sb.append("Right three pure,");
        }
        if ((thirteen.equals(fourteen) && sixteen.equals(fiveteen)) && !fiveteen.equals(thirteen)) {
            sb.append("Right mix pure ,");
        }
        if (sixteen.equals(fiveteen) && thirteen.equals(fourteen)) {
            sb.append("Symmetry,");
        }
        if (sixteen.equals(fourteen) && thirteen.equals(fiveteen)) {
            sb.append("Half divide,");
        }
        if ((fiveteen + thirteen).equals(fourteen + sixteen)) {
            sb.append("Double mix,");
        }
        if (thirteen.equals(fourteen) && !fiveteen.equals(sixteen)) {
            sb.append("Center color,");
        }
        if (fiveteen.equals(sixteen) && !fourteen.equals(thirteen)) {
            sb.append("Edge color,");
        }
        if (distinctChar(style) == 4) {
            sb.append("Sum four color,");
        }
        if (distinctChar(style) == 5) {
            sb.append("Sum five color,");
        }
        if (distinctChar(style) == 6) {
            sb.append("Sum six color,");
        }
        if (distinctChar(style) == 7) {
            sb.append("Sum seven color ,");
        }
        if (distinctChar(style) == 14) {
            sb.append("All 14 color,");
        }
        if (distinctChar(style) == 15) {
            sb.append("All 15 color,");
        }
        if (distinctChar(style) == 16) {
            sb.append("All 16 color,");
        }
        if (darkOrLight(style).equals("1")) {
            sb.append("darkColor,");
        }
        if (darkOrLight(style).equals("0")) {
            sb.append("lightColor,");
        }

        if (sb.length() == 0) {
            return "Common diamond";
        } else {
            return getMaxScoreFeature(sb.toString().substring(0, sb.length() - 1));
        }
    }

    public static String darkOrLight(String styles) {
        int flag = 0;
        String darkColor = "01234";
        String lightColor = "56789abcdef";
        if (darkColor.contains(styles.charAt(0) + "")) {
            flag = 1;
        }
        if (lightColor.contains(styles.charAt(0) + "")) {
            flag = 0;
        }
        char[] chars = styles.toCharArray();
        for (int i = 1; i < chars.length; i++) {
            if (flag == 1 && lightColor.contains(chars[i] + "")) {
                return "2";
            }
            if (flag == 0 && darkColor.contains(chars[i] + "")) {
                return "2";
            }
        }
        if (flag == 1) {
            return "1";
        }
        if (flag == 0) {
            return "0";
        }
        return "2";
    }

    public static String getDiamondshapes(D diamond) {
        String visualGene = diamond.visualGene;
        String[] shapesArray = shapes.split(",");
        for (int i = 0; i < shapesArray.length; i++) {
            if (shapesArray[i].split("\\|")[1].equals(visualGene.substring(0, 2))) {
                return shapesArray[i].split("\\|")[0];
            }
        }
        return "Common diamond";
    }

    public static String getDiamondColor(D diamond) {
        String style = diamond.visualGene.substring(2, 19);
        StringBuffer sb = new StringBuffer();
        String name = diamond.name;
        String[] colorArray = color.split(",");
        for (int i = 0; i < colorArray.length; i++) {
            if (colorArray[i].split("\\|").length > 1) {
                if (colorArray[i].split("\\|")[1].equals(name.charAt(0) + "")) {
                    sb.append(colorArray[i] + ",");
                }
            }
        }
        if (darkOrLight(style).equals("1")) {
            sb.append("darkColor|color,");
        }
        if (darkOrLight(style).equals("0")) {
            sb.append("lightColor|color,");
        }
        if (sb.length() == 0) {
            return "Common diamond";
        } else {
            String s = getMaxScoreFeature(sb.toString().substring(0, sb.length() - 1));
            return s.split("\\|")[0];
        }
    }

    public static String getNumberliterals(D diamond) {
        String number = diamond.number;
        StringBuffer sb = new StringBuffer();
        String[] array = numberliteral.split(",");
        for (int i = 0; i < array.length; i++) {
            if (array[i].equals("Single num")) {
                if (Integer.parseInt(number) < 10) {
                    sb.append("Single num,");
                }
            }
            if (array[i].equals("Repetition")) {
                if (distinctChar(number) == 1) {
                    sb.append("Repetition,");
                }
            }
            if (array[i].equals("Serial num")) {
                if (shunzi(number, 1) || shunzi(number, -1)) {
                    sb.append("Serial num,");
                }
            }
            if (array[i].equals("Tail seven")) {
                if (repeat(number) == 7) {
                    sb.append("Tail seven,");
                }
            }
            if (array[i].equals("Tail six")) {
                if (repeat(number) == 6) {
                    sb.append("Tail six,");
                }
            }
            if (array[i].equals("Tail five")) {
                if (repeat(number) == 5) {
                    sb.append("Tail five,");
                }
            }
            if (array[i].equals("Tail four")) {
                if (repeat(number) == 4) {
                    sb.append("Tail four,");
                }
            }
            // number symmetry / serialRepeat：官方源码中已注释，不参与
        }
        if (sb.length() == 0) {
            return "Common diamond";
        } else {
            return getMaxScoreFeature(sb.toString().substring(0, sb.length() - 1));
        }
    }

    public static String getNameliteral(D diamond) {
        String name = diamond.name;
        StringBuffer sb = new StringBuffer();
        String[] array = nameliteral.split(",");
        for (int i = 0; i < array.length; i++) {
            if (array[i].equals("six repeat")) {
                if (repeat(name) == 6) {
                    sb.append("six repeat,");
                }
            }
            if (array[i].equals("Penta repeat")) {
                if (repeat(name) == 5) {
                    sb.append("Penta repeat,");
                }
            }
            if (array[i].equals("Quadro repeat")) {
                if (repeat(name) == 4) {
                    sb.append("Quadro repeat,");
                }
            }
            if (array[i].equals("Triple repeat")) {
                if (repeat(name) == 3) {
                    sb.append("Triple repeat,");
                }
            }
            if (array[i].equals("Two letters")) {
                if (distinctChar(name) == 2) {
                    sb.append("Two letters,");
                }
            }
            if (array[i].equals("Three letters")) {
                if (distinctChar(name) == 3) {
                    sb.append("Three letters,");
                }
            }
            if (array[i].equals("Half repeat")) {
                if (name.substring(0, 3).equals(name.substring(3, 6))) {
                    sb.append("Half repeat,");
                }
            }
            if (array[i].equals("Symmetric letter")) {
                if (symmetry(name)) {
                    sb.append("Symmetric letter,");
                }
            }
            if (array[i].equals("AABCCD")) {
                if (name.charAt(0) == name.charAt(1) && name.charAt(3) == name.charAt(4)) {
                    sb.append("AABCCD,");
                }
            }
            if (array[i].equals("ABBCDD")) {
                if (name.charAt(1) == name.charAt(2) && name.charAt(4) == name.charAt(5)) {
                    sb.append("ABBCDD,");
                }
            }
        }
        if (sb.length() == 0) {
            return "Common diamond";
        } else {
            return getMaxScoreFeature(sb.toString().substring(0, sb.length() - 1));
        }
    }

    public static boolean symmetry(String s) {
        String s1 = new StringBuffer(s).reverse().toString();
        int mid = s.length() / 2;
        return s.substring(0, mid).equals(s1.substring(0, mid));
    }

    public static int repeat(String s) {
        int max = 0;
        for (int i = 0; i < s.length() - 1; i++) {
            int j = i;
            int count = 1;
            while (j < s.length() - 1 && s.charAt(j) == s.charAt(j + 1)) {
                count++;
                j++;
            }
            i = j;
            max = Math.max(max, count);
        }
        return max;
    }

    public static int distinctChar(String s) {
        Set set = new HashSet();
        char[] a = s.toCharArray();
        for (int i = 0; i < a.length; i++) {
            set.add(a[i]);
        }
        return set.size();
    }

    public static boolean shunzi(String number, int cha) {
        char[] array = number.toCharArray();
        for (int i = 0; i < array.length; i++) {
            if (i == array.length - 1) {
                continue;
            } else {
                if (Integer.parseInt(array[i + 1] + "") - Integer.parseInt(array[i] + "") != cha) {
                    return false;
                }
            }
        }
        return true;
    }

    public static String getMaxScoreFeature(String s) {
        String[] features = s.split(",");
        List<int[]> list = new ArrayList<>();
        List<String> names = new ArrayList<>();
        for (int i = 0; i < features.length; i++) {
            int[] r = map.get(features[i]);
            if (r == null) {
                throw new RuntimeException("rule not found: " + features[i]);
            }
            list.add(r);
            names.add(features[i]);
        }
        // 降序稳定排序等价实现：找最大分，等分取先出现
        int best = 0;
        for (int i = 1; i < list.size(); i++) {
            if (list.get(i)[0] > list.get(best)[0]) {
                best = i;
            }
        }
        return names.get(best);
    }

    public static class D {
        public String name = "", number = "", visualGene = "";
        public String shapes = "", styles = "", color = "", nameliteral = "", numberliteral = "";
        public int score = 0;
    }
}
